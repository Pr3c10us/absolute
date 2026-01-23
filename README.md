# Absolute

## Prerequisites

Ensure you have the following installed on your system:

- **[Bun](https://bun.sh/)** (latest)
- **FFmpeg** (Optional, `ffmpeg-static` is included but system install recommended if issues arise)

## Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Pr3c10us/absolute.git
    cd absolute
    ```

2.  **Install dependencies:**
    ```bash
    bun install
    ```

## Configuration

1.  **Environment Variables:**
    Copy the example environment file:
    ```bash
    cp .env.example .env
    ```

2.  **Update `.env`:**
    Open `.env` and fill in your details. You will need to add your PostgreSQL configuration as it is required for migrations but likely missing from the example:

    ```
    # App Config
    PORT=5000
    URL=http://localhost:5000
    BATCH_SIZE=5
    VIDEO_BATCH_SIZE=2
    # Options: 'nvidia' | 'apple' | 'none'
    HARDWARE_ACCELERATE=nvidia

    # Gemini API
    GEMINI_API_KEY=<YOUR_API_KEY>
    GEMINI_MODEL=gemini-3-pro-preview
    GEMINI_FAST_MODEL=gemini-3-flash-preview
    GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
    ```

## Running the Project
1.  **Start Development Server:**
    ```bash
    bun run dev
    ```

2.  **Start Production Server:**
    ```bash
    bun start
    ```

