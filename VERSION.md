# tracket_test versions

## 1.0.1

- Web calibration is disabled.
- Reading and Writing can start without 5-point or 9-point web calibration.
- Gaze coordinates use the native Tobii stream directly, with manual offset and noise filtering still available.
- Local word calibration is disabled.
- Reading session metadata sends `calibrationStatus: "DISABLED"` and `fivePointCalibration.enabled: false`.

## 1.0.0 rollback snapshot

The pre-1.0.1 frontend files were copied to:

`C:\Users\SSAFY\Desktop\tracket_test\.codex_versions\v1.0.0\public`

Files included:

- `reading.html`
- `reading.css`
- `reading.js`

To roll back the frontend later, restore those three files into:

`C:\Users\SSAFY\Desktop\tracket_test\public`
