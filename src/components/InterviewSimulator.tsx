import { useState, useEffect, useRef, KeyboardEvent } from "react"

// total number of questions per interview session
const QUESTIONS_COUNT = 8

type Screen = "home" | "setup" | "interview"

interface ChatMessage {
  role: "interviewer" | "user"
  text: string
  feedback: string | null
  score: number | null
}

interface ApiMessage {
  role: "user" | "assistant" | "system"
  content: string
}

interface ApiResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

interface ParsedResponse {
  feedback: string | null
  score: number | null
  question: string
}

// Builds the system prompt injecting the job description provided by the user
const buildSystemPrompt = (jobDescription: string): string =>
  `Sei un intervistatore tecnico senior. Ti viene fornita questa job description:

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
[la tua prossima domanda]`

// Returns a color based on score thresholds: green ≥ 8, yellow ≥ 6, red < 6
const getScoreColor = (s: number): string => {
  if (s >= 8) return "#4ade80"
  if (s >= 6) return "#facc15"
  return "#f87171"
}

// Centralized design tokens to keep inline styles consistent
const S = {
  bg: "#0d0d0d",
  surface: "#121212",
  border: "#242424",
  border2: "#333333",
  text: "#e2e2e2",
  dim: "#999999",
  muted: "#4a4a4a",
  accent: "#d4873b",
}

export default function InterviewSimulator() {
  const [screen, setScreen] = useState<Screen>("home")

  const [jobDescription, setJobDescription] = useState("")
  const [jobTitle, setJobTitle] = useState("")

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)

  const [scores, setScores] = useState<number[]>([])
  const [questionCount, setQuestionCount] = useState(0)
  const [finished, setFinished] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the latest message whenever the chat updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Extracts feedback, score, and next question from the model's delimited output
  const parseResponse = (text: string): ParsedResponse => {
    const feedbackMatch = text.match(
      /---FEEDBACK---\n([\s\S]*?)(?=---SCORE---|---DOMANDA---|$)/,
    )
    const scoreMatch = text.match(/---SCORE---\n(\d+)/)
    const questionMatch = text.match(/---DOMANDA---\n([\s\S]*?)$/)

    return {
      feedback: feedbackMatch ? feedbackMatch[1].trim() : null,
      score: scoreMatch ? parseInt(scoreMatch[1]) : null,
      // fall back to raw text if the delimiter is missing
      question: questionMatch ? questionMatch[1].trim() : text.trim(),
    }
  }

  // Resets state and sends the first message to kick off the interview
  const startInterview = async (): Promise<void> => {
    if (!jobDescription.trim()) return

    setScreen("interview")
    setLoading(true)
    setMessages([])
    setScores([])
    setQuestionCount(0)
    setFinished(false)

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: buildSystemPrompt(jobDescription) },
            { role: "user", content: "Inizia il colloquio." },
          ] satisfies ApiMessage[],
        }),
      })

      const data: ApiResponse = await r.json()
      const content = data.choices?.[0]?.message?.content

      if (!r.ok || !content) {
        setMessages([
          {
            role: "interviewer",
            text: `errore: ${data.error?.message ?? "risposta non valida. Riprova."}`,
            feedback: null,
            score: null,
          },
        ])
        return
      }

      const parsed = parseResponse(content)
      setMessages([
        {
          role: "interviewer",
          text: parsed.question,
          feedback: null,
          score: null,
        },
      ])
      setQuestionCount(1)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // Sends the user's answer, appends the model's reply, and tracks scores
  const sendAnswer = async (): Promise<void> => {
    if (!input.trim() || loading) return

    const userMsg = input.trim()
    setInput("")
    setLoading(true)

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", text: userMsg, feedback: null, score: null },
    ]
    setMessages(newMessages)

    const isLast = questionCount >= QUESTIONS_COUNT

    try {
      // Rebuild the full history in API format, re-adding the ---DOMANDA--- delimiter
      // so the model keeps track of the conversation structure
      const apiMessages: ApiMessage[] = newMessages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.role === "interviewer" ? `---DOMANDA---\n${m.text}` : m.text,
      }))

      // On the last question, ask the model to wrap up with a final summary
      if (isLast) {
        apiMessages.push({
          role: "user",
          content:
            "Questa era l'ultima risposta. Dai il feedback finale su questa risposta e concludi con un breve riepilogo delle performance del candidato.",
        })
      }

      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: buildSystemPrompt(jobDescription) },
            ...apiMessages,
          ] satisfies ApiMessage[],
        }),
      })

      const data: ApiResponse = await r.json()
      const content = data.choices?.[0]?.message?.content

      if (!r.ok || !content) {
        setMessages((prev: ChatMessage[]) => [
          ...prev,
          {
            role: "interviewer",
            text: `errore: ${data.error?.message ?? "risposta non valida. Riprova."}`,
            feedback: null,
            score: null,
          },
        ])
        return
      }

      const parsed = parseResponse(content)
      const newScore = parsed.score
      const updatedScores = newScore ? [...scores, newScore] : scores

      if (newScore) setScores(updatedScores)

      setMessages([
        ...newMessages,
        {
          role: "interviewer",
          text: parsed.question || content,
          feedback: parsed.feedback,
          score: newScore,
        },
      ])

      if (isLast) {
        setFinished(true)
      } else {
        setQuestionCount((c: number) => c + 1)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // Average of all scores collected so far, shown in the results panel
  const avgScore =
    scores.length > 0
      ? (
          scores.reduce((a: number, b: number) => a + b, 0) / scores.length
        ).toFixed(1)
      : null

  // Submit on Enter, allow newline with Shift+Enter
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendAnswer()
    }
  }

  // Renders each chat bubble; interviewer uses "$" prefix, user uses ">" prefix
  const renderMessages = (msgs: ChatMessage[]) =>
    msgs.map((msg, i) => (
      <div
        key={i}
        className="msg-enter"
        style={{ display: "flex", flexDirection: "column", gap: 0 }}
      >
        {/* Feedback block shown above the interviewer's next question */}
        {msg.feedback && (
          <div
            style={{
              borderLeft: `2px solid ${getScoreColor(msg.score ?? 5)}`,
              padding: "10px 14px",
              marginBottom: 10,
              background: S.surface,
              fontSize: 13,
              color: S.dim,
              lineHeight: 1.7,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: S.muted,
                  marginBottom: 5,
                  letterSpacing: 1,
                }}
              >
                // feedback
              </div>
              {msg.feedback}
            </div>

            {msg.score !== null && (
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 15,
                  color: getScoreColor(msg.score),
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {msg.score}/10
              </span>
            )}
          </div>
        )}

        {msg.role === "interviewer" ? (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span
              style={{
                color: S.accent,
                fontWeight: 700,
                fontSize: 15,
                lineHeight: 1.8,
                flexShrink: 0,
                userSelect: "none",
              }}
            >
              $
            </span>
            <div style={{ fontSize: 15, lineHeight: 1.8, color: S.text }}>
              {msg.text}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              paddingLeft: 4,
            }}
          >
            <span
              style={{
                color: S.muted,
                fontSize: 15,
                lineHeight: 1.8,
                flexShrink: 0,
                userSelect: "none",
              }}
            >
              {">"}
            </span>
            <div style={{ fontSize: 15, lineHeight: 1.8, color: S.dim }}>
              {msg.text}
            </div>
          </div>
        )}
      </div>
    ))

  // Header breadcrumb: shows current screen / progress during the interview
  const breadcrumb =
    screen === "setup"
      ? "setup"
      : screen === "interview"
        ? finished
          ? "risultati"
          : `q ${questionCount}/${QUESTIONS_COUNT}`
        : null

  return (
    <div
      style={{
        minHeight: "100vh",
        background: S.bg,
        color: S.text,
        display: "flex",
        flexDirection: "column",
        fontSize: 15,
      }}
    >
      {/* ── HEADER ── */}
      <div
        style={{
          borderBottom: `1px solid ${S.border}`,
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          background: S.bg,
          flexShrink: 0,
        }}
      >
        {/* Clicking the logo navigates home, but is disabled mid-interview */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: screen === "interview" && !finished ? "default" : "pointer",
            userSelect: "none",
          }}
          onClick={() =>
            !(screen === "interview" && !finished) && setScreen("home")
          }
        >
          <span style={{ color: S.accent, fontSize: 14, lineHeight: 1 }}>
            ◆
          </span>

          <span
            style={{
              fontWeight: 600,
              fontSize: 13,
              color: S.text,
              letterSpacing: 0.5,
            }}
          >
            interview-simulator
          </span>

          {breadcrumb && (
            <>
              <span style={{ color: S.muted, fontSize: 13 }}>/</span>
              <span
                style={{
                  fontSize: 12,
                  // green while the interview is in progress, dimmed otherwise
                  color:
                    screen === "interview" && !finished ? "#4ade80" : S.dim,
                }}
              >
                {breadcrumb}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── HOME ── */}
      {screen === "home" && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "60px 24px",
          }}
        >
          <div style={{ maxWidth: 540, width: "100%" }}>
            <div
              style={{
                color: S.accent,
                fontSize: 11,
                letterSpacing: 2,
                textTransform: "uppercase",
                marginBottom: 20,
              }}
            >
              ◆ interview-simulator
            </div>

            <div
              style={{
                fontSize: 32,
                fontWeight: 700,
                color: S.text,
                lineHeight: 1.3,
                marginBottom: 16,
              }}
            >
              allenati per
              <br />
              <span style={{ color: S.accent }}>il colloquio tecnico</span>
            </div>

            <div
              style={{
                fontSize: 14,
                color: S.dim,
                lineHeight: 1.9,
                maxWidth: 420,
                marginBottom: 32,
              }}
            >
              L&apos;AI genera domande personalizzate dalla job description e
              valuta ogni risposta con feedback e punteggio.
            </div>

            <button className="btn-main" onClick={() => setScreen("setup")}>
              + nuova simulazione
            </button>
          </div>
        </div>
      )}

      {/* ── SETUP ── */}
      {screen === "setup" && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            maxWidth: 680,
            width: "100%",
            margin: "0 auto",
            padding: "36px 24px",
          }}
        >
          <div style={{ marginBottom: 28 }}>
            <div
              style={{
                fontSize: 11,
                color: S.dim,
                letterSpacing: 2,
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              setup
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: S.text }}>
              nuova simulazione
            </div>
            <div style={{ height: 1, background: S.border, marginTop: 14 }} />
          </div>

          {/* Optional role name — used for display only, not sent to the model */}
          <div style={{ marginBottom: 22 }}>
            <label
              style={{
                display: "block",
                fontSize: 11,
                color: S.dim,
                letterSpacing: 2,
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              nome ruolo <span style={{ color: S.muted }}>(opzionale)</span>
            </label>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                border: `1px solid ${S.border2}`,
                background: S.surface,
              }}
            >
              <span
                style={{
                  padding: "0 10px",
                  color: S.accent,
                  fontSize: 14,
                  userSelect: "none",
                }}
              >
                {">"}
              </span>
              <input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="es. Full-Stack Developer, Data Engineer…"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  color: S.text,
                  padding: "10px 10px 10px 0",
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          {/* Job description is required — it's the sole input to the system prompt */}
          <div
            style={{
              marginBottom: 28,
              flex: 1,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <label
              style={{
                display: "block",
                fontSize: 11,
                color: S.dim,
                letterSpacing: 2,
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              job description <span style={{ color: S.accent }}>*</span>
            </label>

            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="incolla qui la job description completa (responsabilità, requisiti, stack tecnico…)"
              rows={14}
              style={{
                flex: 1,
                width: "100%",
                background: S.surface,
                border: `1px solid ${S.border2}`,
                color: S.text,
                padding: "12px 14px",
                fontSize: 13,
                lineHeight: 1.7,
                resize: "vertical",
              }}
            />

            {jobDescription && (
              <div
                style={{
                  fontSize: 11,
                  color: S.muted,
                  marginTop: 6,
                  textAlign: "right",
                }}
              >
                {jobDescription.length} chars · {QUESTIONS_COUNT} domande
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-ghost" onClick={() => setScreen("home")}>
              ← indietro
            </button>
            <button
              className="btn-main"
              onClick={startInterview}
              disabled={!jobDescription.trim()}
            >
              avvia colloquio →
            </button>
          </div>
        </div>
      )}

      {/* ── INTERVIEW ── */}
      {screen === "interview" && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            maxWidth: 820,
            width: "100%",
            margin: "0 auto",
            padding: "0 24px",
            minHeight: 0,
          }}
        >
          {/* Scrollable message list */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "28px 0",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            {renderMessages(messages)}

            {/* Typing indicator while waiting for the model's response */}
            {loading && (
              <div
                className="msg-enter"
                style={{ display: "flex", gap: 10, alignItems: "center" }}
              >
                <span
                  style={{
                    color: S.accent,
                    fontWeight: 700,
                    fontSize: 15,
                    userSelect: "none",
                  }}
                >
                  $
                </span>
                <span
                  style={{ color: S.accent, fontSize: 15 }}
                  className="blink"
                >
                  _
                </span>
              </div>
            )}

            {/* Results panel shown after the last question is answered */}
            {finished && avgScore && (
              <div
                className="msg-enter"
                style={{
                  border: `1px solid ${S.border2}`,
                  background: S.surface,
                  padding: 28,
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: S.muted,
                    letterSpacing: 2,
                    textTransform: "uppercase",
                    marginBottom: 16,
                  }}
                >
                  // simulazione completata
                </div>

                <div
                  style={{
                    fontSize: 48,
                    fontWeight: 700,
                    color: getScoreColor(parseFloat(avgScore)),
                    marginBottom: 16,
                    lineHeight: 1,
                  }}
                >
                  {avgScore}
                  <span style={{ fontSize: 16, color: S.muted }}>/10</span>
                </div>

                {/* Per-question score badges */}
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                    marginBottom: 24,
                  }}
                >
                  {scores.map((s, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: 12,
                        padding: "3px 9px",
                        border: `1px solid ${getScoreColor(s)}`,
                        color: getScoreColor(s),
                      }}
                    >
                      q{i + 1}: {s}
                    </span>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    className="btn-ghost"
                    onClick={() => setScreen("home")}
                  >
                    ← home
                  </button>
                  <button
                    className="btn-main"
                    onClick={() => setScreen("setup")}
                  >
                    nuova simulazione
                  </button>
                </div>
              </div>
            )}

            {/* Anchor element used by the auto-scroll effect */}
            <div ref={bottomRef} />
          </div>

          {/* Input bar — hidden once the interview is finished */}
          {!finished && (
            <div
              style={{
                borderTop: `1px solid ${S.border}`,
                padding: "14px 0 20px",
                display: "flex",
                gap: 10,
                alignItems: "flex-end",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "flex-start",
                  border: `1px solid ${S.border2}`,
                  background: S.surface,
                  opacity: loading ? 0.5 : 1,
                }}
              >
                <span
                  style={{
                    padding: "12px 10px 12px 12px",
                    color: S.accent,
                    fontSize: 15,
                    userSelect: "none",
                    flexShrink: 0,
                  }}
                >
                  {">"}
                </span>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="scrivi la tua risposta… (invio per inviare, shift+invio per andare a capo)"
                  disabled={loading}
                  rows={3}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    color: S.text,
                    padding: "12px 12px 12px 0",
                    fontSize: 13,
                    lineHeight: 1.6,
                    resize: "none",
                  }}
                />
              </div>

              <button
                className="send-btn"
                onClick={sendAnswer}
                disabled={loading || !input.trim()}
              >
                invia →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
