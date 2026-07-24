@echo off
setlocal
cd /d "%~dp0"

set "SDK_DIR=%TOBII_GAMEINTEGRATION_SDK_DIR%"
if not "%~1"=="" set "SDK_DIR=%~1"

if "%SDK_DIR%"=="" (
  echo Missing Tobii SDK path.
  echo Pass it as the first argument, or set TOBII_GAMEINTEGRATION_SDK_DIR.
  echo Example: build_native.bat C:\path\to\tobii_gameintegration_9.0.4.26
  exit /b 1
)

if not exist "%SDK_DIR%\include\tobii_gameintegration.h" (
  echo Missing Tobii SDK include folder: %SDK_DIR%
  exit /b 1
)

where cl >nul 2>nul
if errorlevel 1 (
  echo cl.exe was not found. Install Visual Studio Build Tools with Desktop development with C++.
  echo Then run this from a Developer Command Prompt, or run vcvars64.bat first.
  exit /b 1
)

if not exist build mkdir build

cl /nologo /EHsc /std:c++17 /W4 ^
  /I "%SDK_DIR%\include" ^
  tobii_native_bridge.cpp ^
  "%SDK_DIR%\include\tobii_gameintegration_dynamic_loader.cpp" ^
  /Fe:build\tobii_native_bridge.exe ^
  /link User32.lib

if errorlevel 1 exit /b %errorlevel%

copy /Y "%SDK_DIR%\bin\x64\tobii_gameintegration_x64.dll" "build\" >nul
echo Built native bridge: %CD%\build\tobii_native_bridge.exe
