@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo   Hypocampus
echo ========================================
echo.

REM ── Premiere fois : npm install
if not exist "web\node_modules" (
    echo [1/3] Installation des dependances ^(~1-2 min, une seule fois^)...
    pushd web
    call npm install
    if errorlevel 1 (
        echo.
        echo ERREUR npm install. Verifie que Node.js est installe.
        popd
        pause
        exit /b 1
    )
    popd
    echo.
)

REM ── Build du site
echo [2/3] Build du site React...
pushd web
call npm run build
if errorlevel 1 (
    echo.
    echo ERREUR de build. Le site ne peut pas demarrer.
    popd
    pause
    exit /b 1
)
popd
echo.

REM ── Ouvre le navigateur
REM Dependances Python pour import PDF
python -c "import pypdf, fitz" >nul 2>nul
if errorlevel 1 (
    echo Installation des dependances Python pour lire les PDF...
    python -m pip install pypdf pymupdf
    if errorlevel 1 (
        echo.
        echo ERREUR pip install pypdf/pymupdf. L'import PDF local ne fonctionnera pas.
        pause
        exit /b 1
    )
)

start "" cmd /c "timeout /t 3 /nobreak >nul && start http://127.0.0.1:8765"

REM ── Lance le serveur Python
echo [3/3] Demarrage du serveur sur http://127.0.0.1:8765
echo.
python server.py

pause
