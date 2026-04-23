import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config(); // Carica le variabili d'ambiente da un file .env


const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(bodyParser.json());

// Proxy per chiamare l'API di Claude
app.post("/api/claude", async (req, res) => {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY, // Chiave API di Claude
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error("Errore durante la chiamata all'API di Claude:", error);
    res.status(500).json({ error: "Errore interno del server" });
  }
});

// CRUD per gestire le sessioni nello storico
const sessions = []; // In memoria (puoi sostituirlo con un database)

// Crea una nuova sessione
app.post("/api/sessions", (req, res) => {
  const { title, content } = req.body;
  const newSession = {
    id: sessions.length + 1,
    title,
    content,
    createdAt: new Date(),
  };
  sessions.push(newSession);
  res.status(201).json(newSession);
});

// Ottieni tutte le sessioni
app.get("/api/sessions", (req, res) => {
  res.json(sessions);
});

// Ottieni una sessione per ID
app.get("/api/sessions/:id", (req, res) => {
  const session = sessions.find((s) => s.id === parseInt(req.params.id));
  if (!session) {
    return res.status(404).json({ error: "Sessione non trovata" });
  }
  res.json(session);
});

// Elimina una sessione
app.delete("/api/sessions/:id", (req, res) => {
  const sessionIndex = sessions.findIndex((s) => s.id === parseInt(req.params.id));
  if (sessionIndex === -1) {
    return res.status(404).json({ error: "Sessione non trovata" });
  }
  sessions.splice(sessionIndex, 1);
  res.status(204).send();
});

// Avvia il server
app.listen(PORT, () => {
  console.log(`Server in esecuzione su http://localhost:${PORT}`);
});