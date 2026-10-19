@echo off
chcp 65001 >nul
title AG-Theme-Daemon
node "%~dp0daemon.js"