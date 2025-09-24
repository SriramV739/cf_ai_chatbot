# README.md

> **Note:** This file was originally written on a google doc. I used ChatGPT to format this README.md in a nice way. 

## Overview

This project implements a minimal AI-powered chatbot using Cloudflare Workers and Workers AI (Llama 3.3). It supports conversational memory via Durable Objects and a simple web UI with Markdown rendering and voice input.

The webpage can be accessed at https://cf-ai-chat.sriram-venkatesh.workers.dev/

## Features

* **Chatbot API**: `/api/chat` endpoint for chat interactions, powered by Llama 3.3.
* **Session Memory**: Persists chat history per session using Durable Objects.
* **CORS Support**: Handles CORS preflight and headers for API endpoints.
* **Markdown Output**: Responses are formatted in GitHub-Flavored Markdown, including fenced code blocks.
* **Web UI**: Minimal HTML page for chat, with Markdown rendering and voice input (Web Speech API).
* **Session Reset**: `/api/reset` endpoint to clear session memory.

## Getting Started

### Prerequisites
* Cloudflare Workers
* Workers AI
* Durable Objects

### Installation
1. Clone the repository:
   git clone https://github.com/Sriramv739/cloudflare-ai-chatbot.git && cd cloudflare-ai-chatbot
2. Install dependencies:
   npm install
3. Run on localhost:
   npx wrangler dev

## API Endpoints
* **POST /api/chat**
  * Request: `{ sessionId: string, message: string }`
  * Response: `{ reply: string }`
  Handles chat messages, persists session history, and returns AI-generated Markdown-formatted replies.
* **POST /api/reset**
  * Request: `{ sessionId: string }`
  * Response: `{ ok: true }`
  Clears session memory for the given session.
* **GET /** 
  Returns the HTML chat UI.

## Web UI
* Type your question and press Send or hit Enter.
* Hold the 🎙️ button to use voice input.
* Session data is temporary—closing the tab erases chat history.
* Demo only—do not share sensitive information.

## Code Structure
* `src/index.ts`: Main Worker entry point, API routing, and session management.
* `SessionDO`: Durable Object class for session memory.
* `getIndexHtml()`: Generates the HTML page for the chat UI.
* Helper functions for CORS, JSON responses, Markdown formatting, and code block detection.

## Customization
* **System Prompt**: Modify `SYSTEM_PROMPT` to change assistant behavior or formatting.
* **Model**: Change the model name in `env.AI.run()` to use a different LLM.
