import { useEffect, useRef, useState } from "react";
import { prepareTopic, sendChat } from "./api.js";

const STORAGE_KEY = "teach-pip-topics-v1";
const PIP = "Pip";

function loadTopics() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

const isComplete = (t) => t.concepts.length > 0 && t.understood.length === t.concepts.length;

function greeting(title) {
  return `Hi!! I'm ${PIP}. Someone told me I have to learn "${title}" today and honestly I don't even know what the first word means. Can you teach me? Go slow, I'm not very smart.`;
}

export default function App() {
  const [topics, setTopics] = useState(loadTopics);
  const [activeId, setActiveId] = useState(() => loadTopics()[0]?.id ?? null);
  const [creating, setCreating] = useState(topics.length === 0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(topics));
    } catch {
      /* storage unavailable; state still works in memory */
    }
  }, [topics]);

  const active = topics.find((t) => t.id === activeId);
  const updateTopic = (id, fn) => setTopics((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));

  function addTopic(topic) {
    setTopics((ts) => [topic, ...ts]);
    setActiveId(topic.id);
    setCreating(false);
  }

  function deleteTopic(id) {
    if (!confirm("Delete this topic and its chat?")) return;
    const rest = topics.filter((t) => t.id !== id);
    setTopics(rest);
    if (activeId === id) {
      setActiveId(rest[0]?.id ?? null);
      if (rest.length === 0) setCreating(true);
    }
  }

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <PipFace size={36} mood="happy" />
          <div>
            <div className="brand-name">Teach {PIP}</div>
            <div className="brand-tag">learn it by explaining it</div>
          </div>
        </div>
        <button
          className="btn primary full"
          onClick={() => {
            setCreating(true);
            setSidebarOpen(false);
          }}
        >
          + New topic
        </button>
        <div className="topic-list">
          {topics.map((t) => (
            <button
              key={t.id}
              className={`topic-item ${t.id === activeId && !creating ? "active" : ""}`}
              onClick={() => {
                setActiveId(t.id);
                setCreating(false);
                setSidebarOpen(false);
              }}
            >
              <span className="topic-title">{t.title}</span>
              <span className={`topic-badge ${isComplete(t) ? "done" : ""}`}>
                {isComplete(t) ? "taught ✓" : `${t.understood.length}/${t.concepts.length}`}
              </span>
            </button>
          ))}
        </div>
      </aside>
      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

      <main className="main">
        <button className="menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open topics">
          ☰
        </button>
        {creating || !active ? (
          <NewTopic onCreate={addTopic} onCancel={topics.length ? () => setCreating(false) : null} />
        ) : (
          <Chat
            key={active.id}
            topic={active}
            update={(fn) => updateTopic(active.id, fn)}
            onDelete={() => deleteTopic(active.id)}
          />
        )}
      </main>
    </div>
  );
}

function NewTopic({ onCreate, onCancel }) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { concepts } = await prepareTopic(title.trim(), notes.trim());
      onCreate({
        id: crypto.randomUUID(),
        title: title.trim(),
        notes: notes.trim(),
        concepts,
        understood: [],
        teachLog: [{ role: "assistant", content: greeting(title.trim()) }],
        reviewLog: [],
        createdAt: Date.now(),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="new-topic" onSubmit={submit}>
      <div className="new-hero">
        <PipFace size={72} mood="confused" />
        <div>
          <h1>What are we teaching {PIP} today?</h1>
          <p>
            {PIP} knows nothing and isn't very bright. Paste your course notes, then explain them until {PIP} actually
            gets it. If you can teach it, you know it.
          </p>
        </div>
      </div>
      <label>
        Topic
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Photosynthesis, Supply and demand, Recursion"
          required
        />
      </label>
      <label>
        Course notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Paste lecture notes, a textbook section, or your study guide. Pip never sees these. They're only used to check your explanations."
          rows={10}
          required
        />
      </label>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? "Reading your notes…" : "Start teaching"}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Chat({ topic, update, onDelete }) {
  const complete = isComplete(topic);
  const mode = complete ? "review" : "teach";
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justLearned, setJustLearned] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [topic.teachLog.length, topic.reviewLog.length, busy]);

  useEffect(() => {
    if (!justLearned) return;
    const t = setTimeout(() => setJustLearned(null), 2600);
    return () => clearTimeout(t);
  }, [justLearned]);

  async function send(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const logKey = mode === "review" ? "reviewLog" : "teachLog";
    const history = [...topic[logKey], { role: "user", content: text }];
    // The API needs the conversation to start with a user turn.
    const apiMessages = history[0]?.role === "assistant" ? history.slice(1) : history;
    update((t) => ({ ...t, [logKey]: history }));
    setDraft("");
    setBusy(true);
    setError("");
    try {
      const { reply, newlyUnderstood } = await sendChat(topic, apiMessages, mode);
      update((t) => {
        const understood = [...t.understood, ...newlyUnderstood.filter((id) => !t.understood.includes(id))];
        const next = { ...t, understood, [logKey]: [...history, { role: "assistant", content: reply, learned: newlyUnderstood }] };
        if (mode === "teach" && understood.length === t.concepts.length && t.reviewLog.length === 0) {
          next.completedAt = Date.now();
          next.reviewLog = [
            {
              role: "assistant",
              content: `I learned ALL of "${t.title}"! Thank you, teacher. Now whenever you want to brush up, come back here and I'll explain it back to you, or quiz you. What do you want to go over?`,
            },
          ];
        }
        return next;
      });
      if (newlyUnderstood.length) {
        const names = topic.concepts.filter((c) => newlyUnderstood.includes(c.id)).map((c) => c.name);
        setJustLearned(names.join(", "));
      }
    } catch (err) {
      setError(err.message);
      update((t) => ({ ...t, [logKey]: history.slice(0, -1) }));
      setDraft(text);
    } finally {
      setBusy(false);
    }
  }

  const pct = Math.round((topic.understood.length / topic.concepts.length) * 100);
  const nameOf = (id) => topic.concepts.find((c) => c.id === id)?.name;

  return (
    <div className="chat">
      <header className="chat-head">
        <div className="chat-title">
          <h2>{topic.title}</h2>
          <span className={`mode-pill ${mode}`}>{complete ? "Re-learn mode" : "Teaching"}</span>
          <button className="icon-btn" onClick={onDelete} title="Delete topic">
            🗑
          </button>
        </div>
        <div className="progress">
          <div className="bar">
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="pct">{pct}% taught</span>
        </div>
        <ul className="concepts">
          {topic.concepts.map((c) => {
            const done = topic.understood.includes(c.id);
            return (
              <li key={c.id} className={done ? "done" : ""}>
                <span className="check">{done ? "✓" : ""}</span>
                {c.name}
              </li>
            );
          })}
        </ul>
      </header>

      <div className="messages">
        {topic.teachLog.map((m, i) => (
          <Message key={`t${i}`} m={m} nameOf={nameOf} />
        ))}
        {complete && (
          <div className="divider">
            <span>🎓 You taught {PIP} everything. Now {PIP} helps you re-learn it.</span>
          </div>
        )}
        {topic.reviewLog.map((m, i) => (
          <Message key={`r${i}`} m={m} nameOf={nameOf} />
        ))}
        {busy && (
          <div className="msg assistant">
            <PipFace size={32} mood="thinking" />
            <div className="bubble typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {justLearned && <div className="toast">💡 {PIP} learned: {justLearned}</div>}
      {error && <div className="error inline">{error}</div>}

      <form className="composer" onSubmit={send}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) send(e);
          }}
          placeholder={complete ? `Ask ${PIP} to explain something, or say "quiz me"…` : `Explain it to ${PIP}… be specific!`}
          rows={2}
          autoFocus
        />
        <button className="btn primary" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function Message({ m, nameOf }) {
  if (m.role === "user") {
    return (
      <div className="msg user">
        <div className="bubble">{m.content}</div>
      </div>
    );
  }
  return (
    <div className="msg assistant">
      <PipFace size={32} mood={m.learned?.length ? "happy" : "confused"} />
      <div className="bubble-wrap">
        <div className="bubble">{m.content}</div>
        {m.learned?.length > 0 && (
          <div className="learned-tag">✓ understood: {m.learned.map(nameOf).filter(Boolean).join(", ")}</div>
        )}
      </div>
    </div>
  );
}

function PipFace({ size = 32, mood = "confused" }) {
  const mouth = {
    happy: "M11 21 Q16 26 21 21",
    confused: "M11 22 Q14 20 16 22 T21 21",
    thinking: "M12 22 L20 22",
  }[mood];
  return (
    <svg className="pip" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="17" r="14" fill="var(--pip)" />
      <path d="M16 3 Q18 0 20 2" stroke="var(--pip-dark)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <circle cx="11" cy="14" r="3.2" fill="#fff" />
      <circle cx="21.5" cy="13" r="4" fill="#fff" />
      <circle cx={mood === "thinking" ? 12 : 11.6} cy={mood === "thinking" ? 12.8 : 14.4} r="1.5" fill="#1d1a2e" />
      <circle cx={mood === "thinking" ? 22.5 : 21} cy={mood === "thinking" ? 11.5 : 13.8} r="1.8" fill="#1d1a2e" />
      <path d={mouth} stroke="#1d1a2e" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
