import { useState, useEffect, useRef } from "react";

const QUESTIONS_COUNT = 8;
const STORAGE_KEY = "interview-simulations";

const buildSystemPrompt = (jobDescription) => `Sei un intervistatore tecnico senior. Ti viene fornita questa job description:

---
${jobDescription}
---

Basandoti ESCLUSIVAMENTE su questa job description, conduci un colloquio tecnico realistico.
Il tuo stile è professionale ma diretto. Fai UNA domanda alla volta, rilevante per il ruolo descritto.
Dopo ogni risposta del candidato:
1. Dai un feedback breve (2-3 righe) sulla risposta, sii onesto
2. Assegna un punteggio da 1 a 10
3. Poi fai la prossima domanda

Inizia con una presentazione breve di te stesso come intervistatore e poi fai la prima domanda.

Formato risposta SEMPRE così:
---FEEDBACK---
[feedback sulla risposta precedente, se c'è]
---SCORE---
[numero 1-10, solo se c'è una risposta precedente]
---DOMANDA---
[la tua prossima domanda]`;

export default function InterviewSimulator() {
  const [screen, setScreen] = useState("home");
  const [jobDescription, setJobDescription] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [scores, setScores] = useState([]);
  const [questionCount, setQuestionCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [simulations, setSimulations] = useState([]);
  const [selectedSim, setSelectedSim] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => { loadSimulations(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const loadSimulations = async () => {
    try {
      const result = await window.storage.get(STORAGE_KEY);
      if (result?.value) setSimulations(JSON.parse(result.value));
    } catch { setSimulations([]); }
  };

  const saveSimulation = async (sim, currentSims) => {
    try {
      const updated = [sim, ...currentSims].slice(0, 20);
      await window.storage.set(STORAGE_KEY, JSON.stringify(updated));
      setSimulations(updated);
    } catch (e) { console.error("Errore salvataggio:", e); }
  };

  const deleteSimulation = async (id) => {
    const updated = simulations.filter((s) => s.id !== id);
    await window.storage.set(STORAGE_KEY, JSON.stringify(updated));
    setSimulations(updated);
    if (selectedSim?.id === id) setSelectedSim(null);
  };

  const parseResponse = (text) => {
    const feedbackMatch = text.match(/---FEEDBACK---\n([\s\S]*?)(?=---SCORE---|---DOMANDA---|$)/);
    const scoreMatch = text.match(/---SCORE---\n(\d+)/);
    const questionMatch = text.match(/---DOMANDA---\n([\s\S]*?)$/);
    return {
      feedback: feedbackMatch ? feedbackMatch[1].trim() : null,
      score: scoreMatch ? parseInt(scoreMatch[1]) : null,
      question: questionMatch ? questionMatch[1].trim() : text.trim(),
    };
  };

  const startInterview = async () => {
    if (!jobDescription.trim()) return;
    setScreen("interview");
    setLoading(true);
    setMessages([]); setScores([]); setQuestionCount(0); setFinished(false);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: buildSystemPrompt(jobDescription),
          messages: [{ role: "user", content: "Inizia il colloquio." }],
        }),
      });

      const data = await response.json();
      const parsed = parseResponse(data.content[0].text);
      setMessages([{ role: "interviewer", text: parsed.question, feedback: null, score: null }]);
      setQuestionCount(1);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const sendAnswer = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setLoading(true);
    const newMessages = [...messages, { role: "user", text: userMsg }];
    setMessages(newMessages);
    const isLast = questionCount >= QUESTIONS_COUNT;
    try {
      const apiMessages = newMessages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.role === "interviewer" ? `---DOMANDA---\n${m.text}` : m.text,
      }));
      if (isLast) {
        apiMessages.push({ role: "user", content: "Questa era l'ultima risposta. Dai il feedback finale su questa risposta e concludi con un breve riepilogo delle performance del candidato." });
      }
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: buildSystemPrompt(jobDescription),
          messages: apiMessages,
        }),
      });
      const data = await response.json();
      const parsed = parseResponse(data.content[0].text);
      const newScore = parsed.score;
      const updatedScores = newScore ? [...scores, newScore] : scores;
      if (newScore) setScores(updatedScores);
      const finalMessages = [...newMessages, { role: "interviewer", text: parsed.question || data.content[0].text, feedback: parsed.feedback, score: newScore }];
      setMessages(finalMessages);
      if (isLast) {
        setFinished(true);
        const avg = updatedScores.length > 0
          ? (updatedScores.reduce((a, b) => a + b, 0) / updatedScores.length).toFixed(1)
          : "N/A";
        const sim = {
          id: Date.now().toString(),
          date: new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
          jobTitle: jobTitle || "Posizione non specificata",
          jobDescription,
          scores: updatedScores,
          avg,
          messages: finalMessages,
        };
        await saveSimulation(sim, simulations);
      } else {
        setQuestionCount((c) => c + 1);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;
  const getScoreColor = (s) => { const n = parseFloat(s); if (n >= 8) return "#4ade80"; if (n >= 6) return "#facc15"; return "#f87171"; };
  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAnswer(); } };

  const dotColor = screen === "interview" && !finished ? "#4ade80" : screen === "history" ? "#facc15" : "#6366f1";

  // Shared message renderer
  const renderMessages = (msgs) => msgs.map((msg, i) => (
    <div key={i} className="msg-enter" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {msg.feedback && (
        <div style={{ background: "#111120", border: "1px solid #1e1e2e", borderLeft: `3px solid ${getScoreColor(msg.score || 5)}`, padding: "12px 16px", fontSize: 12, color: "#9090b0", lineHeight: 1.7, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <span>{msg.feedback}</span>
          {msg.score && <span style={{ fontWeight: 800, fontSize: 18, color: getScoreColor(msg.score), whiteSpace: "nowrap" }}>{msg.score}/10</span>}
        </div>
      )}
      {msg.role === "interviewer" ? (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "white", flexShrink: 0, fontFamily: "'Syne',sans-serif" }}>AI</div>
          <div style={{ background: "#111120", border: "1px solid #1e1e2e", padding: "14px 18px", fontSize: 13, lineHeight: 1.8, color: "#c8c8e8", flex: 1, borderRadius: "0 4px 4px 4px" }}>{msg.text}</div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexDirection: "row-reverse" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#1e1e2e", border: "1px solid #2d2d4d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#6366f1", flexShrink: 0, fontFamily: "'Syne',sans-serif" }}>TU</div>
          <div style={{ background: "#0f0f1f", border: "1px solid #2d2d4d", padding: "14px 18px", fontSize: 13, lineHeight: 1.8, color: "#9090b0", maxWidth: "80%", borderRadius: "4px 0 4px 4px" }}>{msg.text}</div>
        </div>
      )}
    </div>
  ));

  return (
    <div style={{ minHeight: "100vh", color: "#e2e8f0", display: "flex", flexDirection: "column" }}>

      {/* HEADER */}
      <div
        style={{ borderBottom: "1px solid #1e1e2e", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d0d17", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => !(screen === "interview" && !finished) && setScreen("home")}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
          <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: 3, color: "#6366f1", textTransform: "uppercase" }}>Interview Simulator</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {screen === "interview" && !finished && (
            <span style={{ fontSize: 11, color: "#6366f1", fontWeight: 700, marginRight: 12 }}>
              Q {questionCount}/{QUESTIONS_COUNT}
            </span>
          )}
          <button className="nav-btn" style={{ color: screen === "home" || screen === "setup" || screen === "interview" ? "#6366f1" : "#4a4a6a", borderBottom: screen !== "history" ? "2px solid #6366f1" : "2px solid transparent" }}
            onClick={() => { if (screen !== "interview" || finished) setScreen("home"); }}>
            {screen === "setup" ? "Setup" : screen === "interview" ? (finished ? "Home" : "Live") : "Home"}
          </button>
          <button className="nav-btn" style={{ color: screen === "history" ? "#facc15" : "#4a4a6a", borderBottom: screen === "history" ? "2px solid #facc15" : "2px solid transparent" }}
            onClick={() => setScreen("history")}>
            Storico {simulations.length > 0 && `(${simulations.length})`}
          </button>
        </div>
      </div>

      {/* HOME */}
      {screen === "home" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 40, padding: "48px 20px" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.1, marginBottom: 16 }}>
              <span style={{ color: "#6366f1" }}>Allenati per</span><br />
              <span style={{ color: "#0d0d17" }}>il tuo colloquio</span>
            </div>
            <p style={{ color: "#4a4a6a", fontSize: 13, lineHeight: 1.9, maxWidth: 420, margin: "0 auto" }}>
              L'AI creerà un colloquio tecnico personalizzato, ti fornirà una valutazione dettagliata e traccerà i tuoi progressi nel tempo.            </p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button className="btn-main" onClick={() => setScreen("setup")}>+ Nuova Simulazione</button>
            {simulations.length > 0 && <button className="btn-ghost" onClick={() => setScreen("history")}>Vedi Storico →</button>}
          </div>
          {simulations.length > 0 && (
            <div style={{ width: "100%", maxWidth: 540 }}>
              <div style={{ fontSize: 10, letterSpacing: 3, color: "#2d2d3d", textTransform: "uppercase", marginBottom: 10, fontFamily: "'Syne',sans-serif" }}>Ultima sessione</div>
              <div className="sim-card" onClick={() => { setSelectedSim(simulations[0]); setScreen("history"); }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#c8c8e8", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{simulations[0].jobTitle}</div>
                  <div style={{ fontSize: 11, color: "#2d2d4d" }}>{simulations[0].date}</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {simulations[0].scores.map((s, i) => <div key={i} style={{ width: 3, height: 20, background: getScoreColor(s), borderRadius: 2 }} />)}
                  <span style={{ fontWeight: 800, fontSize: 22, color: getScoreColor(simulations[0].avg), marginLeft: 8 }}>{simulations[0].avg}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SETUP */}
      {screen === "setup" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: 680, width: "100%", margin: "0 auto", padding: "36px 20px" }}>
          <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 32, color: "#0d0d17" }}>
            Configura la <span style={{ color: "#6366f1" }}>simulazione</span>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 10, letterSpacing: 3, color: "#4a4a6a", textTransform: "uppercase", display: "block", marginBottom: 8 }}>Nome Ruolo (opzionale)</label>
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="es. Full-Stack Developer, Data Engineer, Product Manager…"
              style={{ width: "100%", border: "1px solid #1e1e2e", color: "#0d0d17", padding: "12px 16px", fontSize: 13, borderRadius: 2 }} />
          </div>
          <div style={{ marginBottom: 28, flex: 1, display: "flex", flexDirection: "column" }}>
            <label style={{ fontSize: 10, letterSpacing: 3, color: "#4a4a6a", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
              Job Description <span style={{ color: "#6366f1" }}>*</span>
            </label>
            <textarea value={jobDescription} onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Incolla qui la job description completa (responsabilità, requisiti, stack tecnico, ecc.)…"
              rows={14}
              style={{ flex: 1, width: "100%", border: "1px solid #1e1e2e", color: "#0d0d17", padding: "14px 16px", fontSize: 12, lineHeight: 1.7, resize: "vertical", borderRadius: 2 }}
            />
            {jobDescription && <div style={{ fontSize: 11, color: "#2d2d3d", marginTop: 6, textAlign: "right" }}>{jobDescription.length} caratteri · {QUESTIONS_COUNT} domande previste</div>}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn-ghost" onClick={() => setScreen("home")}>← Indietro</button>
            <button className="btn-main" onClick={startInterview} disabled={!jobDescription.trim()}>Avvia Colloquio →</button>
          </div>
        </div>
      )}

      {/* INTERVIEW */}
      {screen === "interview" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: 820, width: "100%", margin: "0 auto", padding: "0 20px", minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "24px 0", display: "flex", flexDirection: "column", gap: 18 }}>
            {renderMessages(messages)}
            {loading && (
              <div className="msg-enter" style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "white", fontFamily: "'Syne',sans-serif" }}>AI</div>
                <div style={{ display: "flex", gap: 5 }}>
                  {[0, 0.2, 0.4].map((d, i) => <div key={i} className="blink" style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366f1", animationDelay: `${d}s` }} />)}
                </div>
              </div>
            )}
            {finished && avgScore && (
              <div className="msg-enter" style={{ background: "#0d0d1a", border: "1px solid #6366f1", padding: 28, textAlign: "center", marginTop: 12 }}>
                <div style={{ fontSize: 10, letterSpacing: 3, color: "#4a4a6a", textTransform: "uppercase", marginBottom: 12 }}>
                  Simulazione completata · Salvata automaticamente ✓
                </div>
                <div style={{ fontSize: 52, fontWeight: 800, color: getScoreColor(parseFloat(avgScore)) }}>
                  {avgScore}<span style={{ fontSize: 20, color: "#4a4a6a" }}>/10</span>
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  {scores.map((s, i) => <span key={i} style={{ fontSize: 11, padding: "4px 10px", border: `1px solid ${getScoreColor(s)}`, color: getScoreColor(s), borderRadius: 2 }}>Q{i + 1}: {s}</span>)}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 24 }}>
                  <button className="btn-ghost" onClick={() => setScreen("history")}>Vedi Storico</button>
                  <button className="btn-main" style={{ fontSize: 12, padding: "10px 28px" }} onClick={() => setScreen("setup")}>Nuova Simulazione</button>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          {!finished && (
            <div style={{ borderTop: "1px solid #1e1e2e", padding: "16px 0 20px", display: "flex", gap: 10, alignItems: "flex-end", flexShrink: 0 }}>
              <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder="Scrivi la tua risposta… (Invio per inviare, Shift+Invio per andare a capo)"
                disabled={loading} rows={3}
                style={{ flex: 1, background: "", border: "1px solid #1e1e2e", color: "#c8c8e8", padding: "12px 16px", fontSize: 13, lineHeight: 1.6, resize: "none", borderRadius: 2, opacity: loading ? 0.5 : 1 }} />
              <button className="send-btn" onClick={sendAnswer} disabled={loading || !input.trim()}>INVIA →</button>
            </div>
          )}
        </div>
      )}

      {/* HISTORY */}
      {screen === "history" && (
        <div style={{ flex: 1, display: "flex", maxWidth: 940, width: "100%", margin: "0 auto", padding: "28px 20px", gap: 24, minHeight: 0, overflow: "hidden" }}>
          {/* Sidebar */}
          <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#e2e8f0", marginBottom: 12 }}>
              Storico simulazioni
              <span style={{ color: "#4a4a6a", fontWeight: 400, fontSize: 12, marginLeft: 8 }}>({simulations.length})</span>
            </div>
            {simulations.length === 0 ? (
              <div style={{ color: "#2d2d4d", fontSize: 12, lineHeight: 1.8 }}>
                Nessuna simulazione salvata.<br />
                <span style={{ color: "#6366f1", cursor: "pointer" }} onClick={() => setScreen("setup")}>Iniziane una →</span>
              </div>
            ) : simulations.map((sim) => (
              <div key={sim.id} style={{ position: "relative" }}>
                <div className={`sim-card${selectedSim?.id === sim.id ? " active" : ""}`} onClick={() => setSelectedSim(sim)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: "#c8c8e8", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sim.jobTitle}</div>
                    <div style={{ fontSize: 10, color: "#2d2d4d" }}>{sim.date}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {sim.scores.map((s, i) => <div key={i} style={{ width: 3, height: 18, background: getScoreColor(s), borderRadius: 1 }} />)}
                    <span style={{ fontWeight: 800, fontSize: 18, color: getScoreColor(sim.avg), marginLeft: 6 }}>{sim.avg}</span>
                  </div>
                </div>
                <button className="del-btn" onClick={(e) => { e.stopPropagation(); deleteSimulation(sim.id); }} style={{ position: "absolute", top: 6, right: 6 }}>×</button>
              </div>
            ))}
          </div>

          {/* Detail panel */}
          <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
            {!selectedSim ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#2d2d3d", fontSize: 12, flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 32 }}>←</div>
                Seleziona una simulazione per rivedere il transcript
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ border: "1px solid #6366f1", padding: "18px 22px", background: "#0d0d1a" }}>
                  <div style={{ fontWeight: 800, fontSize: 17, color: "#e2e8f0", marginBottom: 4 }}>{selectedSim.jobTitle}</div>
                  <div style={{ fontSize: 11, color: "#4a4a6a", marginBottom: 18 }}>{selectedSim.date}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontSize: 40, color: getScoreColor(selectedSim.avg) }}>
                      {selectedSim.avg}<span style={{ fontSize: 16, color: "#4a4a6a" }}>/10</span>
                    </span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {selectedSim.scores.map((s, i) => (
                        <span key={i} style={{ fontSize: 11, padding: "3px 10px", border: `1px solid ${getScoreColor(s)}`, color: getScoreColor(s), borderRadius: 2 }}>Q{i + 1}: {s}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 10, letterSpacing: 3, color: "#2d2d3d", textTransform: "uppercase", paddingLeft: 4 }}>Transcript</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {renderMessages(selectedSim.messages)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}