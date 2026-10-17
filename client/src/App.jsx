import { useEffect, useRef, useState } from "react";
import { getDepths, getHealth, prepareTopic, sendChat } from "./api.js";
import { allItems, stageOf } from "../../server/rubric.js";

const STORAGE_KEY = "teach-stu-topics-v2";
const STU = "Stu";

const FALLBACK_DEPTHS = [
  { key: "basics", label: "Big picture", blurb: "The main ideas and how they fit, in plain words." },
  { key: "exam", label: "Exam-ready", blurb: "Precise definitions, mechanisms and key conditions." },
  { key: "deep", label: "Expert", blurb: "Why it works, where it breaks, and the fine details." },
];

function loadTopics() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

const isComplete = (t) => stageOf(t, t.credited) === "done";
const progressOf = (t) => {
  const items = allItems(t);
  return { done: items.filter((id) => t.credited[id]).length, total: items.length };
};

function greeting(title) {
  return `Hi!! I'm ${STU}. Someone told me I have to learn "${title}" today and honestly I don't even know what the first word means. Can you teach me? Go slow, I'm not very smart.`;
}

export default function App() {
  const [topics, setTopics] = useState(loadTopics);
  const [activeId, setActiveId] = useState(() => loadTopics()[0]?.id ?? null);
  const [creating, setCreating] = useState(topics.length === 0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showJudge, setShowJudge] = useState(false);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => {});
  }, []);

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
          <StuFace size={36} mood="happy" />
          <div>
            <div className="brand-name">Teach {STU}</div>
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
          {topics.map((t) => {
            const p = progressOf(t);
            return (
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
                  {isComplete(t) ? "taught ✓" : `${Math.round((p.done / p.total) * 100)}%`}
                </span>
              </button>
            );
          })}
        </div>
        <label className="judge-toggle">
          <input type="checkbox" checked={showJudge} onChange={(e) => setShowJudge(e.target.checked)} />
          Show the hidden judge
        </label>
        {health && <div className="provider">AI: {health.mock ? "mock mode" : `${health.provider} · ${health.model ?? "no key"}`}</div>}
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
            showJudge={showJudge}
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
  const [depths, setDepths] = useState(FALLBACK_DEPTHS);
  const [depth, setDepth] = useState("exam");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDepths().then(setDepths).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { ideas, connections } = await prepareTopic(title.trim(), notes.trim(), depth);
      onCreate({
        id: crypto.randomUUID(),
        title: title.trim(),
        notes: notes.trim(),
        depth,
        ideas,
        connections,
        credited: {},
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
        <StuFace size={72} mood="confused" />
        <div>
          <h1>What are we teaching {STU} today?</h1>
          <p>
            {STU} knows nothing and isn't very bright. Paste your course notes, then explain them until {STU} actually
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
      <fieldset className="depths">
        <legend>How deep do you need to know it?</legend>
        <div className="depth-options">
          {depths.map((d) => (
            <label key={d.key} className={`depth ${depth === d.key ? "selected" : ""}`}>
              <input type="radio" name="depth" value={d.key} checked={depth === d.key} onChange={() => setDepth(d.key)} />
              <span className="depth-label">{d.label}</span>
              <span className="depth-blurb">{d.blurb}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        Course notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={`Paste lecture notes, a textbook section, or your study guide. ${STU} never sees these. They're only used to check your explanations.`}
          rows={9}
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

function Chat({ topic, showJudge, update, onDelete }) {
  const stage = stageOf(topic, topic.credited);
  const complete = stage === "done";
  const mode = complete ? "review" : "teach";
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [topic.teachLog.length, topic.reviewLog.length, busy]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  async function send(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const logKey = mode === "review" ? "reviewLog" : "teachLog";
    const history = [...topic[logKey], { role: "user", content: text }];
    // The API needs the conversation to start with a user turn.
    const apiMessages = (history[0]?.role === "assistant" ? history.slice(1) : history).map(({ role, content }) => ({
      role,
      content,
    }));
    update((t) => ({ ...t, [logKey]: history }));
    setDraft("");
    setBusy(true);
    setError("");
    try {
      const { reply, credited, revoked, problems } = await sendChat(topic, apiMessages, mode);
      update((t) => {
        const next = { ...t.credited };
        for (const c of credited) next[c.item] = c.evidence;
        for (const id of revoked) delete next[id];
        const judged = { ...history[history.length - 1], judge: mode === "teach" ? { credited, revoked, problems } : undefined };
        const updated = {
          ...t,
          credited: next,
          [logKey]: [...history.slice(0, -1), judged, { role: "assistant", content: reply, learned: credited.length > 0 }],
        };
        if (mode === "teach" && stageOf(t, next) === "done" && t.reviewLog.length === 0) {
          updated.completedAt = Date.now();
          updated.reviewLog = [
            {
              role: "assistant",
              content: `I learned ALL of "${t.title}"! Thank you, teacher. Now whenever you want to brush up, come back here and I'll explain it back to you, or quiz you. What do you want to go over?`,
            },
          ];
        }
        return updated;
      });
      if (revoked.length) setToast({ kind: "bad", text: `${STU} got confused again about something you'd taught` });
      else if (credited.length) setToast({ kind: "good", text: `💡 ${STU} learned something!` });
    } catch (err) {
      setError(err.message);
      update((t) => ({ ...t, [logKey]: history.slice(0, -1) }));
      setDraft(text);
    } finally {
      setBusy(false);
    }
  }

  const { done, total } = progressOf(topic);
  const pct = Math.round((done / total) * 100);

  return (
    <div className="chat">
      <header className="chat-head">
        <div className="chat-title">
          <h2>{topic.title}</h2>
          <span className="depth-pill">{FALLBACK_DEPTHS.find((d) => d.key === topic.depth)?.label}</span>
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
      </header>

      <div className="messages">
        {topic.teachLog.map((m, i) => (
          <Message key={`t${i}`} m={m} topic={topic} showJudge={showJudge} />
        ))}
        {complete && (
          <div className="divider">
            <span>🎓 You taught {STU} everything. Now {STU} helps you re-learn it.</span>
          </div>
        )}
        {topic.reviewLog.map((m, i) => (
          <Message key={`r${i}`} m={m} topic={topic} showJudge={showJudge} />
        ))}
        {busy && (
          <div className="msg assistant">
            <StuFace size={32} mood="thinking" />
            <div className="bubble typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
      {error && <div className="error inline">{error}</div>}

      <form className="composer" onSubmit={send}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) send(e);
          }}
          placeholder={complete ? `Ask ${STU} to explain something, or say "quiz me"…` : `Explain it to ${STU}… be specific!`}
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

function itemLabel(topic, item) {
  const [kind, id] = item.split(":");
  if (kind === "link") return topic.connections.find((k) => k.id === id)?.name ?? item;
  const name = topic.ideas.find((i) => i.id === id)?.name ?? item;
  return kind === "cover" ? `${name} (named)` : `${name} (explained)`;
}

const PROBLEM_LABELS = {
  wrong: "Wrong",
  vague: "Too vague",
  missing_step: "Missing step",
  undefined_term: "Undefined term",
  off_topic: "Off topic",
};

function Message({ m, topic, showJudge }) {
  if (m.role === "user") {
    const j = m.judge;
    return (
      <div className="msg user">
        <div className="bubble-wrap">
          <div className="bubble">{m.content}</div>
          {showJudge && j && (
            <div className="judge">
              <div className="judge-head">Judge's verdict</div>
              {j.credited.length === 0 && j.revoked.length === 0 && <div className="judge-none">Nothing credited.</div>}
              {j.credited.map((c) => (
                <div key={c.item} className="judge-row good">
                  ✓ {itemLabel(topic, c.item)} <span className="judge-quote">“{c.evidence}”</span>
                </div>
              ))}
              {j.revoked.map((id) => (
                <div key={id} className="judge-row bad">
                  ↺ revoked: {itemLabel(topic, id)}
                </div>
              ))}
              {j.problems.map((p, i) => (
                <div key={i} className="judge-row bad">
                  <b>{PROBLEM_LABELS[p.kind] ?? p.kind}:</b> {p.note}
                  {p.quote && <span className="judge-quote">“{p.quote}”</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="msg assistant">
      <StuFace size={32} mood={m.learned ? "happy" : "confused"} />
      <div className="bubble">{m.content}</div>
    </div>
  );
}

function StuFace({ size = 32, mood = "confused" }) {
  const mouth = {
    happy: "M11 21 Q16 26 21 21",
    confused: "M11 22 Q14 20 16 22 T21 21",
    thinking: "M12 22 L20 22",
  }[mood];
  return (
    <svg className="stu" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="17" r="14" fill="var(--stu)" />
      <path d="M16 3 Q18 0 20 2" stroke="var(--stu-dark)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <circle cx="11" cy="14" r="3.2" fill="#fff" />
      <circle cx="21.5" cy="13" r="4" fill="#fff" />
      <circle cx={mood === "thinking" ? 12 : 11.6} cy={mood === "thinking" ? 12.8 : 14.4} r="1.5" fill="#1d1a2e" />
      <circle cx={mood === "thinking" ? 22.5 : 21} cy={mood === "thinking" ? 11.5 : 13.8} r="1.8" fill="#1d1a2e" />
      <path d={mouth} stroke="#1d1a2e" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
