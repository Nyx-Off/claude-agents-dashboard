# Claude Agents Dashboard

> **[Read in English](README.md)**

**Tableau de bord temps reel 8-bit pour visualiser les agents Claude Code.**

Chaque agent lancé par Claude Code apparait en direct sur le dashboard avec ses actions, commandes, fichiers lus/ecrits, et son sprite unique.

---

## Ce que ca fait

- Affiche chaque agent (Explorer, Planner, Reviewer...) avec un sprite pixel-art unique
- Liste en temps reel les tool calls de chaque agent (Bash, Read, Write, Grep, Glob...)
- Attribution precise : chaque tool call est lie au bon agent, meme avec plusieurs agents en parallele
- Log d'activite global, systeme d'XP, detail au clic
- Zero framework, zero build step, zero dependance npm

## Architecture

```
Claude Code CLI  ──hook.sh──>  Server Node.js (localhost:8787)  <──poll──  Dashboard (navigateur)
```

1. Les **hooks** Claude Code (`PreToolUse` / `PostToolUse`) envoient chaque evenement au serveur via `hook.sh`
2. Le **serveur** Node.js stocke l'etat en memoire et le sert via API JSON
3. Le **dashboard** HTML poll le serveur chaque seconde et affiche tout en pixel-art

---

## Prerequis

| Outil | Version | Installation |
|---|---|---|
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org) ou `winget install OpenJS.NodeJS.LTS` |
| **Claude Code CLI** | latest | `npm install -g @anthropic-ai/claude-code` |
| **bash** | any | Inclus avec Git for Windows, WSL, macOS, Linux |
| **curl** | any | Inclus sur macOS/Linux, inclus avec Git for Windows |
| **jq** | any | Optionnel mais recommande — `winget install jqlang.jq` / `brew install jq` / `apt install jq` |

> **Note Windows** : Git for Windows fournit `bash` et `curl` dans Git Bash. Assure-toi que `bash` est dans ton PATH (c'est le cas par defaut avec Git for Windows).

---

## Installation

### 1. Cloner le repo

```bash
git clone https://github.com/Nyx-Off/claude-agents-dashboard.git
cd claude-agents-dashboard
```

### 2. Configurer les hooks Claude Code

Ajoute ceci dans ton fichier `~/.claude/settings.json` :

**Linux / macOS :**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/claude-agents-dashboard/hook.sh pre"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/claude-agents-dashboard/hook.sh post"
          }
        ]
      }
    ]
  }
}
```

**Windows (Git Bash) :**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/Documents/claude-agents-dashboard/hook.sh pre"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/Documents/claude-agents-dashboard/hook.sh post"
          }
        ]
      }
    ]
  }
}
```

> Adapte le chemin selon ou tu as clone le repo. Le `~` est resolu par bash.

> Si tu as deja un `settings.json` avec d'autres options, ajoute juste la section `hooks` a l'interieur.

### 3. Lancer le serveur

```bash
npm start
```

Ou sur Windows, double-clic sur `start.bat`.

Le serveur demarre sur `http://localhost:8787` et ouvre le navigateur automatiquement.

### 4. Utiliser Claude Code normalement

Lance Claude Code dans n'importe quel projet. Des qu'un agent est cree (via l'outil Agent), il apparait sur le dashboard avec ses tool calls en temps reel.

---

## Verification rapide

Pour verifier que tout fonctionne :

1. Lance le serveur : `npm start`
2. Ouvre http://localhost:8787 — tu dois voir "Disconnected" puis "Connected"
3. Dans Claude Code, demande quelque chose qui lance un agent, par exemple :
   ```
   Lance un agent Explorer pour lister les fichiers du projet
   ```
4. L'agent doit apparaitre sur le dashboard avec ses actions

Si l'agent n'apparait pas, verifie :
- Que le serveur tourne bien (`curl http://localhost:8787/api/agents` doit repondre du JSON)
- Que les hooks sont dans `~/.claude/settings.json` (pas dans le settings.local.json du projet)
- Que le chemin vers `hook.sh` est correct et que `bash` est dans le PATH

---

## Configuration avancee

### Changer le port

```bash
# Edite server.js ligne 5 :
const PORT = 9000;
```

Et mets a jour `DASHBOARD_URL` dans le hook :
```bash
DASHBOARD_URL=http://localhost:9000 bash hook.sh pre
```

Ou exporte la variable :
```bash
export DASHBOARD_URL=http://localhost:9000
```

### Serveur sur une autre machine

Le hook et le serveur communiquent via HTTP. Tu peux lancer le serveur sur une machine distante :

1. Modifie `server.js` pour ecouter sur `0.0.0.0` au lieu de `127.0.0.1` :
   ```js
   server.listen(PORT, '0.0.0.0', () => { ... });
   ```
2. Mets `DASHBOARD_URL=http://<ip-du-serveur>:8787` dans les hooks

### Limites configurables (server.js)

| Constante | Defaut | Description |
|---|---|---|
| `PORT` | `8787` | Port d'ecoute |
| `MAX_AGENTS` | `50` | Nombre max d'agents en memoire |
| `MAX_TOOL_CALLS` | `50` | Nombre max de tool calls par agent |
| `MAX_LOG` | `200` | Nombre max d'entrees dans le log |
| `DONE_TTL_MS` | `30 min` | Duree avant suppression d'un agent termine |
| `IDLE_TIMEOUT_MS` | `15 s` | Delai d'inactivite avant de marquer un agent "done" |

---

## Structure du projet

```
claude-agents-dashboard/
├── server.js        # Serveur HTTP Node.js (API + fichiers statiques)
├── index.html       # Dashboard navigateur (HTML/CSS/JS vanilla)
├── hook.sh          # Script bash appele par les hooks Claude Code
├── start.bat        # Lanceur Windows (double-clic)
├── package.json     # Metadata npm
├── agents.json      # Etat runtime (auto-genere, gitignore)
├── README.md
├── CONTRIBUTING.md
├── LICENSE          # MIT
└── .claude/
    └── CLAUDE.md    # Instructions projet pour Claude Code
```

---

## Comment ca marche en detail

### Attribution des tool calls

Claude Code fournit `agent_id` et `agent_type` dans le JSON des hooks pour les tool calls effectues par des sous-agents. Les outils du parent (conversation principale) n'ont pas ces champs.

Le hook utilise cette distinction pour :
- **Ignorer** les outils du parent (pas de pollution)
- **Attribuer precisement** chaque tool call au bon agent

Quand un agent est lance, le hook envoie un evenement `start`. Les tool calls suivants arrivent avec le `agent_id` natif de Claude Code, ce qui permet une attribution 1:1 meme avec plusieurs agents en parallele.

### Auto-detection de fin d'agent

Le `PostToolUse` de l'outil `Agent` se declenche quand l'agent est **dispatche**, pas quand il finit. Le serveur detecte automatiquement la fin d'un agent : si aucun tool call pendant 15 secondes, l'agent est marque "done".

### Sprites composables

Chaque agent recoit un visage unique genere a partir de son ID via un systeme composable :
- 3 formes de tete × 6 paires d'yeux × 4 bouches × 5 accessoires = **360 combinaisons**
- Le meme agent aura toujours le meme visage (hash deterministe)
- Les yeux s'animent quand l'agent travaille

---

## Desinstallation

1. Supprime le dossier du projet
2. Retire la section `hooks` de `~/.claude/settings.json`

---

## License

[MIT](LICENSE)
