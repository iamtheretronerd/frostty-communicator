# Frostty Telegram Bot

A standalone Node.js application that provides a Telegram Bot interface for the Frostty AI coding agent.

## Setup

1.  **Dependencies**:
    Run `npm install` to install the required packages (`telegraf`, `axios`, `dotenv`, `strip-ansi`).

2.  **Configuration**:
    Rename/Copy `.env` and fill in the details:
    ```env
    TELEGRAM_BOT_TOKEN=your_token_from_botfather
    FROSTTY_BINARY_PATH=C:\path\to\frostty.exe
    DEFAULT_PROJECT_PATH=C:\path\to\your\project
    PORT=3000
    ```
    -   `TELEGRAM_BOT_TOKEN`: Get this from @BotFather on Telegram.
    -   `FROSTTY_BINARY_PATH`: Absolute path to your compiled `frostty` executable.
    -   `DEFAULT_PROJECT_PATH`: The directory where Frostty should start by default.

3.  **Run**:
    ```bash
    npm start
    ```

## Features

-   **Process Management**: Automatically starts `frostty serve`. Monitors health and allows restarting via "Wake" command.
-   **Session Management**: Create (`/new`), list (`/sessions`), and switch (`/session <id>`) sessions.
-   **Chat**: Interact with Frostty directly from Telegram.
-   **Project Switching**: Switch the active workspace using `/project <path>`.
-   **Status Monitoring**: Type `?` or `/status` to see what tool Frostty is currently running.
