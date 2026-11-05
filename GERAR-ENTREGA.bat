@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Gerando a entrega - Spacecom

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js nao encontrado. Instale em https://nodejs.org e rode este arquivo de novo.
  pause
  exit /b 1
)

echo Instalando dependencias (so demora na primeira vez)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo O npm install falhou. Tire um print desta tela e mande para o Claude.
  pause
  exit /b 1
)

call npm run tudo
set RESULTADO=%errorlevel%

echo.
if "%RESULTADO%"=="0" (
  echo PRONTO! Vou abrir a pasta "entrega": anexe o .zip que esta nela no e-mail.
) else (
  echo ATENCAO: algo nao bateu. Mande o arquivo relatorios\relatorio-completo.txt para o Claude antes de enviar.
)
if exist "entrega" explorer "entrega"
pause
