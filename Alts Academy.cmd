@echo off
setlocal
cd /d "%~dp0"

REM  Alts Academy launcher.
REM
REM  Double-click this to study. It serves the built app on http://localhost:5173
REM  and opens your browser at it.
REM
REM  Why a server rather than just opening dist\index.html: the build loads its code
REM  as an ES module, and browsers refuse to load module scripts from a file:// path
REM  (CORS treats a local file as having no origin). Opening the file directly gives
REM  a blank page. A local server is the fix, and it never touches the network.
REM
REM  Port 5173 is deliberate: progress lives in the browser's storage, which is keyed
REM  to the exact address. Using the same port as `npm run dev` means both show the
REM  same history rather than two separate blank slates.

if not exist "dist\index.html" (
  echo No build found. Building it now — this takes a few seconds...
  call npm run build
  if errorlevel 1 (
    echo.
    echo The build failed. Open a terminal here and run: npm install ^&^& npm run build
    pause
    exit /b 1
  )
)

echo Starting Alts Academy on http://localhost:5173
echo.
echo Leave this window open while you study. Close it to stop the app.
echo.

REM  Give the server a moment to bind before the browser asks for the page.
start "" cmd /c "timeout /t 2 /nobreak >nul & start """" http://localhost:5173/"

cd dist
python -m http.server 5173 --bind 127.0.0.1

REM  Reached when the server exits (this window closed, or the port was busy).
if errorlevel 1 (
  echo.
  echo Could not start the server on port 5173.
  echo If `npm run dev` is already running, the app is at http://localhost:5173 already.
  pause
)
