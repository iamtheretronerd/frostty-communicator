require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const stripAnsi = require('strip-ansi');

// Configuration
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const FROSTTY_PATH = process.env.FROSTTY_BINARY_PATH;
const DEFAULT_CWD = process.env.DEFAULT_PROJECT_PATH;
const PORT = process.env.PORT || 3000;
const API_URL = `http://localhost:${PORT}`;

if (!TOKEN || !FROSTTY_PATH || !DEFAULT_CWD) {
  console.error('Missing required environment variables. Please check .env'); // eslint-disable-line no-console
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

// State
let frosttyProcess = null;
let currentSessionId = null;
let latestStatus = 'Idle';
let currentCwd = DEFAULT_CWD;

/**
 * Spawns the Frostty process in the specified directory.
 * @param {string} cwd - The working directory for the process.
 */
function spawnFrostty(cwd) {
  if (frosttyProcess) {
    try {
      frosttyProcess.kill();
    } catch (e) {
      console.error('Error killing process:', e); // eslint-disable-line no-console
    }
  }

  console.log(`Spawning Frostty in ${cwd}...`); // eslint-disable-line no-console
  currentCwd = cwd;
  
  // spawn: frostty serve --port PORT
  frosttyProcess = spawn(FROSTTY_PATH, ['serve', '--port', PORT], {
    cwd: cwd,
    shell: true, // Use shell to handle path resolution better on Windows
    env: { ...process.env, PATH: process.env.PATH } // inherit env
  });

  frosttyProcess.stdout.on('data', (data) => {
    // Optional: Log stdout to console for debugging
    // console.log(`[Frostty]: ${data}`);
  });

  frosttyProcess.stderr.on('data', (data) => {
    // console.error(`[Frostty Err]: ${data}`);
  });

  frosttyProcess.on('close', (code) => {
    console.log(`Frostty process exited with code ${code}`); // eslint-disable-line no-console
    frosttyProcess = null;
    latestStatus = 'Process Exited';
  });
}

/**
 * Checks if Frostty API is reachable.
 * @returns {Promise<boolean>}
 */
async function checkHealth() {
  try {
    // Assuming GET /api/session is a valid way to check health/auth
    // Or just check if port is open. The prompt suggests GET /api/session
    await axios.get(`${API_URL}/api/session`, { timeout: 2000 });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Wake logic: Kills zombie, spawns new, polls for health.
 * @param {object} ctx - Telegraf context
 */
async function wakeFrostty(ctx) {
  await ctx.reply('Waking up Frostty... 💤 -> ⚡');
  spawnFrostty(currentCwd);

  // Poll for up to 10 seconds
  let online = false;
  for (let i = 0; i < 10; i++) {
    const isHealthy = await checkHealth();
    if (isHealthy) {
      online = true;
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (online) {
    await ctx.reply('Frostty is online! 🟢');
  } else {
    await ctx.reply('Failed to wake Frostty. Check process logs or path.');
  }
}

// --- Middlewares & Commands ---

// Startup
spawnFrostty(DEFAULT_CWD);

// /start
bot.start(async (ctx) => {
  const isHealthy = await checkHealth();
  if (!isHealthy) {
    await ctx.reply("Frostty is sleeping. Reply 'wake' to start.");
    return;
  }

  // Fetch sessions
  try {
    const res = await axios.get(`${API_URL}/api/session`);
    const sessions = res.data; // Assuming array of { id, title? } or similar

    if (sessions && sessions.length > 0) {
      let msg = "Active Sessions:\n";
      sessions.forEach((s, i) => {
        msg += `${i + 1}. ${s.title || s.id} (ID: \`${s.id}\`)\n`;
      });
      msg += "\nReply `/session <id>` to resume or `/new` to start fresh.";
      await ctx.replyWithMarkdown(msg);
    } else {
      // 0 sessions, auto-create
      await createNewSession(ctx);
    }
  } catch (err) {
    console.error(err); // eslint-disable-line no-console
    await ctx.reply("Error fetching sessions.");
  }
});

// Wake handler (case-insensitive "Wake")
bot.hears(/wake/i, async (ctx) => {
  await wakeFrostty(ctx);
});

// /sessions
bot.command('sessions', async (ctx) => {
  const isHealthy = await checkHealth();
  if (!isHealthy) return ctx.reply("Frostty is sleeping. Reply 'wake' to start.");

  try {
    const res = await axios.get(`${API_URL}/api/session`);
    const sessions = res.data;
    if (sessions.length === 0) {
      return ctx.reply("No active sessions. Use /new to create one.");
    }
    let msg = "Active Sessions:\n";
    sessions.forEach((s, i) => {
      msg += `${i + 1}. ${s.title || 'Untitled'} (ID: \`${s.id}\`)\n`;
    });
    msg += "\nReply `/session <ID>` to switch.";
    await ctx.replyWithMarkdown(msg);
  } catch (error) {
    ctx.reply(`Error: ${error.message}`);
  }
});

async function createNewSession(ctx) {
  try {
    const res = await axios.post(`${API_URL}/api/session`, {});
    const newId = res.data.id;
    currentSessionId = newId;
    await ctx.reply(`New session started. 📝\nID: \`${newId}\``, { parse_mode: 'Markdown' });
  } catch (error) {
    await ctx.reply(`Failed to create session: ${error.message}`);
  }
}

// /new
bot.command('new', async (ctx) => {
  const isHealthy = await checkHealth();
  if (!isHealthy) return ctx.reply("Frostty is sleeping. Reply 'wake' to start.");
  await createNewSession(ctx);
});

// /session <ID>
bot.command('session', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply("Usage: /session <ID>");
  
  const id = args[1].trim();
  // Verify existence
  const isHealthy = await checkHealth();
  if (!isHealthy) return ctx.reply("Frostty is sleeping. Reply 'wake' to start.");

  try {
    // Check if ID is in list
    const res = await axios.get(`${API_URL}/api/session`);
    const exists = res.data.find(s => s.id === id);
    if (!exists) {
      return ctx.reply("Session ID not found.");
    }
    currentSessionId = id;
    await ctx.reply(`Switched to session \`${id}\`.`, { parse_mode: 'Markdown' });
  } catch (error) {
    ctx.reply("Error verifying session.");
  }
});

// /project <Path>
bot.command('project', (ctx) => {
  const text = ctx.message.text;
  const path = text.replace('/project', '').trim();

  if (!path) return ctx.reply("Usage: /project <Absolute Path>");

  fs.stat(path, (err, stats) => {
    if (err || !stats.isDirectory()) {
      return ctx.reply("Invalid directory path.");
    }

    // Switch
    spawnFrostty(path);
    currentSessionId = null;
    ctx.reply(`📂 Switched workspace to \`${path}\`.\nPlease start a /new session.`, { parse_mode: 'Markdown' });
  });
});

// /status or ?
bot.hears(['?', '/status'], (ctx) => {
  ctx.reply(`Status: ${stripAnsi(latestStatus)}\nSession: ${currentSessionId || 'None'}`);
});

// Chat Handler
bot.on('text', async (ctx) => {
  // Ignore commands
  if (ctx.message.text.startsWith('/')) return;

  // Check Health
  const isHealthy = await checkHealth();
  if (!isHealthy) {
    return ctx.reply("Frostty is sleeping. Reply 'wake' to start.");
  }

  if (!currentSessionId) {
    return ctx.reply("No active session. Type /new or /start.");
  }

  const userMessage = ctx.message.text;
  
  // Send typing action
  ctx.sendChatAction('typing');

  try {
    const response = await axios({
      method: 'post',
      url: `${API_URL}/api/session/${currentSessionId}/message`,
      data: { text: userMessage },
      responseType: 'stream'
    });

    let buffer = '';
    let accumulatedText = '';
    latestStatus = 'Thinking...';

    const stream = response.data;

    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      // Keep the last partial line in the buffer
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          
          if (event.type === 'tool_use') {
             // example: { type: 'tool_use', tool: 'cmd', params: '...' }
             // Adjust based on actual Frostty API shape. 
             // Providing a generic fallback logic.
             const toolName = event.tool || event.name || 'Tool';
             latestStatus = `Running ${toolName}...`;
          } else if (event.type === 'text') {
             // example: { type: 'text', content: 'Hello' }
             accumulatedText += (event.content || event.text || '');
          }
        } catch (e) {
          // Ignore parse errors for partial lines
        }
      }
    });

    stream.on('end', () => {
      if (buffer.trim()) {
        try {
            const event = JSON.parse(buffer);
            if (event.type === 'text') accumulatedText += (event.content || event.text || '');
        } catch(e) {}
      }

      latestStatus = 'Idle';
      if (accumulatedText.trim()) {
        ctx.reply(accumulatedText);
      } else {
        ctx.reply("✅ Task Completed.");
      }
    });

  } catch (error) {
    console.error(error); // eslint-disable-line no-console
    ctx.reply(`Error calling Frostty: ${error.message}`);
  }
});

// Launch Bot
bot.launch().then(() => {
    console.log('Bot started!'); // eslint-disable-line no-console
}).catch(err => {
    console.error('Failed to start bot', err); // eslint-disable-line no-console
});

// Enable graceful stop
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    if (frosttyProcess) frosttyProcess.kill();
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    if (frosttyProcess) frosttyProcess.kill();
});
