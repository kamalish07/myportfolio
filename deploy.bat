@echo off
echo Saving and deploying changes to GitHub...

REM Add all changes (including new pages, blocks.json, etc.)
git add .

REM Commit changes with a timestamp
git commit -m "CMS Update: %date% %time%"

REM Push to GitHub
git push origin main

echo.
echo Deployment complete! Your live site will update shortly.
pause
