// src/index.ts

// ---------- Minimal types (remove if you're using @cloudflare/workers-types) ----------
type Ai = any;
type VectorizeIndex = any;

export interface Env {
  AI: Ai;                               // Workers AI (LLM + embeddings)
  SESSION_DO: DurableObjectNamespace;   // Durable Object binding
  // VECTORIZE?: VectorizeIndex;        // Optional: bind if you use Vectorize/RAG
}

type ChatTurn = { role: "user" | "assistant"; content: string };

// Small JSON helper with CORS headers
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    },
  });

// Stronger system prompt to force Markdown + fenced code blocks
const SYSTEM_PROMPT = [
  "You are a concise, helpful assistant.",
  "Always format your response in GitHub-Flavored Markdown.",
  "When sharing code, use fenced code blocks with a language tag, e.g. ```ts ... ```.",
  "Preserve indentation and line breaks exactly as in code.",
  "Do not escape backticks; do not wrap code in quotes.",
  "Do not paste code when the question does not involve any code",
].join(" ");

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(req.url);

    // --- CORS preflight ---
    if (req.method === "OPTIONS") {
      return new Response("", {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type,authorization",
        },
      });
    }

    // --- Chat endpoint ---
    if (url.pathname === "/api/chat" && req.method === "POST") {
      const { sessionId = "default", message } = await req.json().catch(() => ({} as any));
      if (!message || typeof message !== "string") return json({ error: "message required" }, 400);

      // 1) Load session history from Durable Object (persisted during session)
      const id = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(id);
      const history: ChatTurn[] = await stub.fetch("https://do/memory").then((r) => r.json());

      // 2) (Optional) Vectorize retrieval (kept behind try/catch; safe if not bound)
      let context = "";
      try {
        // @ts-ignore - only if VECTORIZE is bound
        if (env.VECTORIZE) {
          const embed = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: message });
          const vec = (embed as any)?.data?.[0];
          if (vec) {
            // @ts-ignore
            const { matches } = await env.VECTORIZE.query(vec, { topK: 3 });
            context = matches?.map((m: any) => m?.metadata?.text || "").filter(Boolean).join("\n---\n") || "";
          }
        }
      } catch {
        // ignore if not configured
      }

      // 3) Call LLM (Workers AI — Llama 3.3) with Markdown-oriented system prompt
      const messages = [
        { role: "system", content: SYSTEM_PROMPT + (context ? `\n\nContext:\n${context}` : "") },
        ...history,
        { role: "user", content: message },
      ];

      const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages,
        max_tokens: 1500,          // allow room for Markdown & code blocks
        temperature: 0.4,         // steadier formatting
      });

      let reply = (result as any)?.response ?? (result as any)?.result ?? "…";
      reply = ensureFencesIfLooksLikeCode(reply); // mild guard if model forgets fences

      // 4) Persist updated history for this session (cap last N turns)
      const MAX_TURNS = 20;
      const updated: ChatTurn[] = [
        ...history,
        { role: "user", content: message },
        { role: "assistant", content: reply },
      ].slice(-MAX_TURNS);

      await stub.fetch("https://do/memory", {
        method: "POST",
        body: JSON.stringify(updated),
      });

      return json({ reply });
    }

    // --- Reset endpoint: erase a session's memory on tab close (sendBeacon) ---
    if (url.pathname === "/api/reset" && req.method === "POST") {
      const { sessionId } = await req.json().catch(() => ({} as any));
      if (!sessionId) return json({ ok: false, error: "sessionId required" }, 400);

      const id = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(id);
      await stub.fetch("https://do/memory", { method: "DELETE" });

      return json({ ok: true });
    }

    // --- Inline test page (text + voice) with Markdown rendering ---
    if (url.pathname === "/" && req.method === "GET") {
      return new Response(await getIndexHtml(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return json({ error: "Not Found" }, 404);
  },
} satisfies ExportedHandler<Env>;

// ---------------- Durable Object: session memory (persisted during session) ----------------
export class SessionDO implements DurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(req: Request) {
    const url = new URL(req.url);

    if (url.pathname.endsWith("/memory")) {
      if (req.method === "GET") {
        const history = (await this.state.storage.get<ChatTurn[]>("history")) ?? [];
        return json(history);
      }
      if (req.method === "POST") {
        const incoming = (await req.json()) as ChatTurn[];
        const MAX_TURNS = 20;
        await this.state.storage.put("history", incoming.slice(-MAX_TURNS));
        return json({ ok: true });
      }
      if (req.method === "DELETE") {
        await this.state.storage.delete("history"); // erase the session's memory
        return json({ ok: true, cleared: true });
      }
    }

    return json({ error: "Not found" }, 404);
  }
}

// ----------------------------- Helpers --------------------------------------
function ensureFencesIfLooksLikeCode(text: string, lang = "txt") {
  if (/```/.test(text)) return text;
  // crude heuristic: many braces/semicolons/indents or import/function keywords
  const looksCode = /[{;]\s*$|^\s{2,}/m.test(text) || /(import|export|function|class)\s/.test(text);
  return looksCode ? `\`\`\`${lang}\n${text}\n\`\`\`` : text;
}

// --------------------------------- HTML page ---------------------------------
async function getIndexHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Cloudflare AI Chat</title>
  <style>
    :root { color-scheme: light dark; }
    body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:2rem;max-width:780px;line-height:1.45}
    h1,h2{margin-top:0}
    .guidelines{background:#f9f9f9;border:1px solid #ddd;border-radius:8px;padding:1rem;margin-bottom:1rem}
    .guidelines h2{margin-bottom:.5rem;font-size:1.2rem}
    .guidelines ul{padding-left:1.2rem}
    .row{display:flex;gap:.5rem;margin:.6rem 0}
    .msg{padding:.6rem .8rem;border-radius:.7rem;background:#f3f3f3}
    .me{background:#e7f0ff}
    #mic{padding:.55rem .8rem;border-radius:.6rem;border:1px solid #ccc;cursor:pointer}
    #mic.recording{background:#ffecec;border-color:#f66}
    pre.code-block { background:#111; color:#eee; padding:0.75rem; border-radius:8px; overflow:auto; margin:.5rem 0 }
    code.inline-code { background:#f2f2f2; padding:0.1rem 0.3rem; border-radius:4px }
    pre.code-block code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9rem; }
    .msg b{display:block;margin-bottom:.25rem}
    input[type="text"]{border:1px solid #d0d0d0;border-radius:.5rem}
    button{border:1px solid #d0d0d0;background:#fff;border-radius:.5rem;cursor:pointer}
    .error{background:#fee;border:1px solid #f88;color:#600;padding:.5rem .75rem;border-radius:.5rem;margin:.5rem 0;display:none}
    @media (prefers-color-scheme: dark){
      .msg{background:#222}
      .me{background:#1e2a3a}
      input[type="text"],button{background:#111;color:#eee;border-color:#333}
      code.inline-code{background:#222}
      .error{background:#402;border-color:#a55;color:#fdd}
      .guidelines{background:#1e1e1e;border-color:#333}
    }
  </style>
</head>
<body>
  <h1>AI Chatbot</h1>

  <!-- Guidelines Section -->
  <div class="guidelines">
    <h2>How to Use This Chat</h2>
    <ul>
      <li><strong>Type</strong> your question below and press <em>Send</em> or hit <kbd>Enter</kbd>.</li>
      <li>Hold the <strong>🎙️ button</strong> to speak instead of typing.</li>
      <li><strong>Session data is temporary</strong> — closing the tab erases the chat history.</li>
      <li>This is a demo. <strong>Don't share sensitive information.</strong></li>
    </ul>
  </div>

  <!-- Error display -->
  <div id="err" class="error" role="alert"></div>

  <!-- Chat log -->
  <div id="log" aria-live="polite"></div>

  <!-- Input Row -->
  <div class="row">
    <input id="t" type="text" placeholder="Ask anything" style="flex:1;padding:.6rem" autocomplete="off" />
    <button id="send" type="button">Send</button>
    <button id="mic" type="button" title="Hold to talk" aria-label="Hold to talk">Hold to Talk 🎙️</button>
  </div>

  <script>
  const $ = (id)=>document.getElementById(id);
  const log = $('log');
  const t = $('t');
  const send = $('send');
  const mic = $('mic');
  const err = $('err');

  // Generate per-tab session id
  let sid = sessionStorage.getItem('sid');
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem('sid', sid);
  }

  // Show or hide error messages
  const showErr = (msg) => { err.textContent = msg; err.style.display = 'block'; console.error('[ui]', msg); };
  const hideErr = () => { err.style.display = 'none'; err.textContent = ''; };

  function escapeHtml(s){
    return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  // Minimal Markdown renderer
  function renderMarkdown(md) {
    try {
      md = escapeHtml(md);
      const bt = String.fromCharCode(96); // backtick character
      const fence = new RegExp('[' + bt + ']{3}(\\\\w+)?\\n([\\s\\S]*?)[' + bt + ']{3}', 'g');
      const inline = new RegExp('[' + bt + ']([^' + bt + ']+)[' + bt + ']', 'g');

      // Fenced code blocks
      md = md.replace(fence, (_, lang, code) => {
        const langAttr = lang ? ' data-lang="' + lang + '"' : '';
        return '<pre class="code-block"><code' + langAttr + '>' + code.replace(/</g,'&lt;') + '</code></pre>';
      });

      // Inline code
      md = md.replace(inline, (_, c) => '<code class="inline-code">' + c + '</code>');

      // Bold and italic
      md = md.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>'); // **bold**
      md = md.replace(/(^|\\s)\\*([^*]+)\\*(?=\\s|$)/g, '$1<em>$2</em>'); // *italic*

      // Paragraphs and line breaks
      return md.split(/\\n{2,}/).map(p => '<p>' + p.replace(/\\n/g, '<br>') + '</p>').join('');
    } catch (e) {
      console.error('renderMarkdown failed', e);
      return escapeHtml(md);
    }
  }

  function addMarkdown(role, md){
    const div = document.createElement('div');
    div.className='row';
    const content = renderMarkdown(md);
    div.innerHTML = '<div class="msg '+(role==='user'?'me':'')+'"><b>'+role+':</b><div>'+content+'</div></div>';
    log.appendChild(div); log.scrollTop = log.scrollHeight;
  }

  // API call to send message
  async function callChat(message){
    const res = await fetch('/api/chat', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ sessionId: sid, message })
    });
    let json;
    try { json = await res.json(); }
    catch { throw new Error('Invalid JSON response'); }
    if (!res.ok) throw new Error(json?.error || ('HTTP ' + res.status));
    return json;
  }

  async function onSend(){
    hideErr();
    const m = t.value.trim();
    if (!m) return;
    addMarkdown('user', escapeHtml(m));
    t.value = '';
    send.disabled = true; send.textContent = '…';
    try {
      const r = await callChat(m);
      addMarkdown('assistant', r.reply ?? '(no reply)');
    } catch (e) {
      addMarkdown('assistant', '(error)');
      showErr('Request failed: ' + (e?.message || e));
    } finally {
      send.disabled = false; send.textContent = 'Send';
    }
  }

  // Enter key to send
  t.addEventListener('keydown', (e)=>{ 
    if (e.key === 'Enter' && !e.shiftKey) { 
      e.preventDefault(); 
      onSend(); 
    } 
  });
  send.addEventListener('click', onSend);

  // Wipe server memory on tab close
  function resetMemory() {
    try {
      const blob = new Blob([JSON.stringify({ sessionId: sid })], { type: "application/json" });
      navigator.sendBeacon('/api/reset', blob);
    } catch (_) {}
  }
  window.addEventListener('pagehide', resetMemory);
  window.addEventListener('beforeunload', resetMemory);

  // Voice input with Web Speech API
  let recog;
  function startRec() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showErr("SpeechRecognition not supported."); return; }
    recog = new SR();
    recog.lang = 'en-US';
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onstart = ()=> mic.classList.add('recording');
    recog.onend = ()=> mic.classList.remove('recording');
    recog.onerror = (e)=> showErr('Speech error: ' + (e?.error || 'unknown'));
    recog.onresult = async (e)=>{
      const message = e.results[0][0].transcript;
      addMarkdown('user', escapeHtml(message));
      send.disabled = true; send.textContent = '…';
      try {
        const r = await callChat(message);
        addMarkdown('assistant', r.reply ?? '(no reply)');
      } catch (e2) {
        addMarkdown('assistant', '(error)');
        showErr('Request failed: ' + (e2?.message || e2));
      } finally {
        send.disabled = false; send.textContent = 'Send';
      }
    };
    recog.start();
  }
  mic.onmousedown = startRec;
  mic.onmouseup = ()=>{ try { recog && recog.stop(); } catch{} };
  </script>
</body>
</html>`;
}
