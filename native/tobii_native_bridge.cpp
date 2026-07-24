#define WIN32_LEAN_AND_MEAN

#include <windows.h>

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>

#include "tobii_gameintegration.h"

using namespace TobiiGameIntegration;

namespace
{
    using TgiRectangle = TobiiGameIntegration::Rectangle;

    std::atomic_bool g_running(true);

    BOOL WINAPI ConsoleHandler(DWORD event)
    {
        if (event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT || event == CTRL_CLOSE_EVENT)
        {
            g_running = false;
            return TRUE;
        }
        return FALSE;
    }

    int EnvInt(const char* name, int fallback)
    {
        char* raw = nullptr;
        size_t len = 0;
        if (_dupenv_s(&raw, &len, name) != 0 || raw == nullptr)
        {
            return fallback;
        }

        int value = std::atoi(raw);
        std::free(raw);
        return value > 0 ? value : fallback;
    }

    bool EnvBool(const char* name, bool fallback)
    {
        char* raw = nullptr;
        size_t len = 0;
        if (_dupenv_s(&raw, &len, name) != 0 || raw == nullptr)
        {
            return fallback;
        }

        std::string value(raw);
        std::free(raw);
        return value == "1" || value == "true" || value == "TRUE" || value == "yes";
    }

    std::string EnvString(const char* name, const char* fallback)
    {
        char* raw = nullptr;
        size_t len = 0;
        if (_dupenv_s(&raw, &len, name) != 0 || raw == nullptr)
        {
            return fallback;
        }

        std::string value(raw);
        std::free(raw);
        return value;
    }

    double Clamp01(double value)
    {
        if (value < 0.0) return 0.0;
        if (value > 1.0) return 1.0;
        return value;
    }

    int64_t NowMs()
    {
        const auto now = std::chrono::system_clock::now().time_since_epoch();
        return std::chrono::duration_cast<std::chrono::milliseconds>(now).count();
    }

    void WriteError(const std::string& message)
    {
        std::cerr << message << std::endl;
    }

    struct NormalizedGaze
    {
        double X;
        double Y;
        const char* Unit;
        bool Clamped;
    };

    int RectWidth(const TgiRectangle& rect)
    {
        return rect.Right - rect.Left;
    }

    int RectHeight(const TgiRectangle& rect)
    {
        return rect.Bottom - rect.Top;
    }

    bool IsUsableRect(const TgiRectangle& rect)
    {
        return RectWidth(rect) > 0 && RectHeight(rect) > 0;
    }

    TgiRectangle GetFallbackDisplayRect()
    {
        const int left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        const int top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        const int width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        const int height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        return { left, top, left + width, top + height };
    }

    TgiRectangle ResolveDisplayRect(ITobiiGameIntegrationApi* api, ITrackerController* tracker)
    {
        TgiRectangle rect = GetFallbackDisplayRect();
        tracker->UpdateTrackerInfos();

        for (int attempt = 0; attempt < 30; ++attempt)
        {
            api->Update();

            TrackerInfo trackerInfo;
            if (tracker->IsConnected() && tracker->GetTrackerInfo(trackerInfo) && IsUsableRect(trackerInfo.DisplayRectInOSCoordinates))
            {
                return trackerInfo.DisplayRectInOSCoordinates;
            }

            const TrackerInfo* trackerInfos = nullptr;
            int trackerCount = 0;
            if (tracker->GetTrackerInfos(trackerInfos, trackerCount))
            {
                for (int i = 0; i < trackerCount; ++i)
                {
                    if (trackerInfos[i].IsAttached && IsUsableRect(trackerInfos[i].DisplayRectInOSCoordinates))
                    {
                        return trackerInfos[i].DisplayRectInOSCoordinates;
                    }
                }
            }

            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }

        return rect;
    }

    NormalizedGaze NormalizeGazePoint(const GazePoint& gazePoint, int width, int height, const std::string& unitMode)
    {
        const double rawX = gazePoint.X;
        const double rawY = gazePoint.Y;
        double normalizedX = rawX;
        double normalizedY = rawY;
        const char* unit = "normalized";

        if (unitMode == "normalized")
        {
            unit = "normalized";
        }
        else if (unitMode == "pixels")
        {
            unit = "pixels";
            normalizedX = width > 0 ? rawX / static_cast<double>(width) : 0.5;
            normalizedY = height > 0 ? rawY / static_cast<double>(height) : 0.5;
        }
        else if (rawX >= -1.0 && rawX <= 1.0 && rawY >= -1.0 && rawY <= 1.0)
        {
            unit = "signed-normalized";
            normalizedX = (rawX + 1.0) * 0.5;
            normalizedY = (rawY + 1.0) * 0.5;
        }
        else
        {
            unit = "pixels";
            normalizedX = width > 0 ? rawX / static_cast<double>(width) : 0.5;
            normalizedY = height > 0 ? rawY / static_cast<double>(height) : 0.5;
        }

        const double clampedX = Clamp01(normalizedX);
        const double clampedY = Clamp01(normalizedY);
        return {
            clampedX,
            clampedY,
            unit,
            clampedX != normalizedX || clampedY != normalizedY
        };
    }
}

int main()
{
    SetConsoleCtrlHandler(ConsoleHandler, TRUE);

    const bool flipX = EnvBool("TOBII_BRIDGE_FLIP_X", false);
    const bool flipY = EnvBool("TOBII_BRIDGE_FLIP_Y", false);
    const std::string unitMode = EnvString("TOBII_BRIDGE_UNIT_MODE", "signed");

    ITobiiGameIntegrationApi* api = GetApiDynamic("Local Tobii Web Bridge", "tobii_gameintegration_x64.dll");
    if (api == nullptr)
    {
        WriteError("GetApi returned null. Check that tobii_gameintegration_x64.dll is next to this executable or on PATH.");
        return 2;
    }

    ITrackerController* tracker = api->GetTrackerController();
    IStreamsProvider* streams = api->GetStreamsProvider();
    if (tracker == nullptr || streams == nullptr)
    {
        WriteError("Tobii API did not return tracker/streams interfaces.");
        api->Shutdown();
        return 3;
    }

    const TgiRectangle displayRect = ResolveDisplayRect(api, tracker);
    const int screenWidth = EnvInt("TOBII_BRIDGE_SCREEN_WIDTH", RectWidth(displayRect));
    const int screenHeight = EnvInt("TOBII_BRIDGE_SCREEN_HEIGHT", RectHeight(displayRect));
    const TgiRectangle trackingRect = {
        displayRect.Left,
        displayRect.Top,
        displayRect.Left + screenWidth,
        displayRect.Top + screenHeight
    };

    tracker->TrackRectangle(trackingRect);

    while (g_running)
    {
        api->Update();

        GazePoint gazePoint;
        const bool valid = streams->GetLatestGazePoint(gazePoint);
        const bool presence = streams->IsPresent();

        if (valid)
        {
            const NormalizedGaze normalized = NormalizeGazePoint(gazePoint, screenWidth, screenHeight, unitMode);
            const double x = flipX ? 1.0 - normalized.X : normalized.X;
            const double topLeftY = 1.0 - normalized.Y;
            const double y = flipY ? 1.0 - topLeftY : topLeftY;
            const int screenX = trackingRect.Left + static_cast<int>(x * screenWidth);
            const int screenY = trackingRect.Top + static_cast<int>(y * screenHeight);

            std::cout
                << "{\"type\":\"gaze\","
                << "\"source\":\"tobii\","
                << "\"x\":" << x << ","
                << "\"y\":" << y << ","
                << "\"tobiiY\":" << normalized.Y << ","
                << "\"screenX\":" << screenX << ","
                << "\"screenY\":" << screenY << ","
                << "\"trackingLeft\":" << trackingRect.Left << ","
                << "\"trackingTop\":" << trackingRect.Top << ","
                << "\"trackingRight\":" << trackingRect.Right << ","
                << "\"trackingBottom\":" << trackingRect.Bottom << ","
                << "\"trackingWidth\":" << screenWidth << ","
                << "\"trackingHeight\":" << screenHeight << ","
                << "\"rawX\":" << gazePoint.X << ","
                << "\"rawY\":" << gazePoint.Y << ","
                << "\"rawUnit\":\"" << normalized.Unit << "\","
                << "\"filter\":\"frontend-outlier-gate\","
                << "\"flipX\":" << (flipX ? "true" : "false") << ","
                << "\"flipY\":" << (flipY ? "true" : "false") << ","
                << "\"clamped\":" << (normalized.Clamped ? "true" : "false") << ","
                << "\"valid\":true,"
                << "\"presence\":" << (presence ? "true" : "false") << ","
                << "\"trackerTimestampUs\":" << gazePoint.TimeStampMicroSeconds << ","
                << "\"timestamp\":" << NowMs()
                << "}" << std::endl;
        }
        else
        {
            std::cout
                << "{\"type\":\"gaze\","
                << "\"source\":\"tobii\","
                << "\"x\":0.5,"
                << "\"y\":0.5,"
                << "\"screenX\":" << (trackingRect.Left + screenWidth / 2) << ","
                << "\"screenY\":" << (trackingRect.Top + screenHeight / 2) << ","
                << "\"trackingLeft\":" << trackingRect.Left << ","
                << "\"trackingTop\":" << trackingRect.Top << ","
                << "\"trackingRight\":" << trackingRect.Right << ","
                << "\"trackingBottom\":" << trackingRect.Bottom << ","
                << "\"trackingWidth\":" << screenWidth << ","
                << "\"trackingHeight\":" << screenHeight << ","
                << "\"valid\":false,"
                << "\"presence\":" << (presence ? "true" : "false") << ","
                << "\"timestamp\":" << NowMs()
                << "}" << std::endl;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(16));
    }

    tracker->StopTracking();
    api->Shutdown();
    return 0;
}
