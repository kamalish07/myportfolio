@echo off
echo Starting Website Server on port 4173...
start "Website Server" cmd /c "cd website && node server.js"

echo Starting CMS Server on port 4174...
start "CMS Server" cmd /c "cd cms && node server.js"

echo Opening CMS in your browser...
timeout /t 2 /nobreak > nul
start http://localhost:4174

echo.
echo Both servers are running in separate windows.
echo Close this window when you're done, and remember to close the other two server windows as well.
pause
