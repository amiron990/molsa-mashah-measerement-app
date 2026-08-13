@echo off
chcp 65001 >nul
REM ============================================================
REM  מצפן רשויות מקומיות — הרצת הכלי כאתר HTTP מקומי
REM
REM  הדשבורד ב-biportal מוגש ב-HTTP, ודפדפן חוסם הטמעת HTTP
REM  בתוך דף HTTPS. הרצה מכאן מגישה את הכלי ב-HTTP, ולכן
REM  הדשבורד נטען בתוך המסגרת כרגיל.
REM
REM  לחיצה כפולה על הקובץ מפעילה את השרת ופותחת את הדפדפן.
REM  לסיום — סגירת חלון זה.
REM ============================================================

set PORT=8770
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Python לא נמצא במחשב הזה.
  echo   התקינו Python מ-https://www.python.org/downloads/ ^(סמנו "Add to PATH"^),
  echo   או השתמשו בכל שרת HTTP סטטי אחר שמגיש את התיקייה הזו.
  echo.
  pause
  exit /b 1
)

echo.
echo   הכלי מוגש עכשיו בכתובות:
echo.
echo     במחשב הזה:      http://localhost:%PORT%/workshop.html
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=1" %%b in ("%%a") do echo     ברשת המקומית:  http://%%b:%PORT%/workshop.html
)
echo.
echo   כדי שמשתתפים אחרים יוכלו להתחבר לכתובת שברשת המקומית,
echo   צריך לאשר את הפורט בחומת האש ^(פעם אחת, כמנהל^):
echo     netsh advfirewall firewall add rule name="KYD workshop %PORT%" dir=in action=allow protocol=TCP localport=%PORT%
echo.
echo   לעצירת השרת — סגרו את החלון הזה.
echo.

start "" "http://localhost:%PORT%/workshop.html"
python -m http.server %PORT% --bind 0.0.0.0
