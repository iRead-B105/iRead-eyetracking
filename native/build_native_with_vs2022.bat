@echo off
setlocal

set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" goto missing_vcvars

call "%VCVARS%"
if errorlevel 1 exit /b %errorlevel%

call "%~dp0build_native.bat" %*
exit /b %errorlevel%

:missing_vcvars
echo Missing vcvars64.bat.
exit /b 1
