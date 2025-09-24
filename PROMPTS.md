# List of AI prompts used

> **Note:** This file and README.md was originally written on a google doc. I used ChatGPT to format PROMPTS.md and README.md in a nice way. 



## Prompt 1:
I need to make an AI powered chatbot hosted on Cloudflare. I have the base framework included already. Specifically, I have a file called `wrangler.toml` that has information about the Cloudflare configuration.

It is to run off of a file called `index.ts` that you will write.

This file should:

1. Serve a static web page with:
   - A **text input** and a **send button**.  
   - A **chat log** that shows the entire conversation.

2. Implement an `/api/chat` endpoint that:
   - Accepts a JSON message consisting of the **prompt**.  
   - Sends this message to a Cloudflare worker, specifically **Llama** at the endpoint:
     ```
     @cf/meta/llama-3.3-70b-instruct-fp8-fast
     ```

3. Use a **Durable Object** to keep track of the memory history:
   - Store conversation context for future messages.  
   - Use an array called `ChatTurn`.  
   - When `ChatTurn` is **not empty**, pass it into the Llama API as **context**.

4. Start with a **base system prompt** like this:
   ```
   You are a concise, helpful assistant. Always format your response in GitHub-Flavored Markdown. Preserve indentation and line breaks exactly as in code.
   ```
   - You can add elements to improve the prompt.  
   - The output should **preserve tabs and indentation** when displayed.

5. Ensure that:
   - The HTML and JavaScript are **inline** (no external files).  
   - The UI is simple — **no third-party frameworks** that require installation.

---

## Prompt 2:
The memory seems to be deleted every time:
```
private history: ChatTurn[] = [];
```
is called.

Rewrite to make sure the memory is **saved in `state.storage.put`** so that after each query the history **does not get reset**.

---

## Prompt 3:
Whenever a new browser tab is opened, I want the memory for that tab to be **fresh**. Do the following:

1. **Implement session IDs for each tab.**
2. Use `sessionStorage` instead of `localStorage`:
   - The `sessionId` should **expire when the tab is closed**.

3. Add a `/reset` endpoint:
   - This endpoint **resets the memory** for the current session.

4. Add a **DELETE path** for the Durable Object on `/memory`:
   - This should **erase `this.state.storage`** for the specific session’s history.



---

## Prompt 4:
Add a **microphone utility** using the **Web Speech API**:

1. Record audio using the browser's built-in capabilities.  
2. Convert the audio to **text**.  
3. Pass the converted text **directly** into `/api/chat` as if it were typed.

> **Note:**  
> - Only modify **HTML code** to integrate this feature.  
> - Once audio is converted to text, it is treated like any normal text input and sent to `/api/chat`.

---

## Prompt 5:
There seems to be issues on this line:
```
...s\\S]*?)[\\u0060]{3}/g; // ```lang\ncode\n``` (backtick = \u0060)
```
Fix the **HTML error**, which is caused by **backslash not being an acceptable escape character**.

---

## Prompt 6:
Add **helpful hints** at the top of the page to explain:
- What the app is about.  
- How to use it effectively.
