// vim: sw=2 ts=2 expandtab smartindent ft=javascript
const SPLITSCREEN = true;
const BROWSER_HOST = false;
const BROWSER = (typeof window) == "object";
const NODE = !BROWSER;

/* maybe we will want to make the game tick less often on the server
 * to save CPU cycles, or maybe we need to tick the game faster
 * to resolve a timing bug.
 *
 * by configuring times like 2*SECOND_IN_TICKS, not only does the
 * developer get to think in terms of a unit they're already
 * familiar with -- seconds -- they also get the ability to
 * change how many times per second their game logic runs,
 * simply by changing this variable. */
const SECOND_IN_TICKS = 60; 

/* -- NETSIM: USING CODE TO PRETEND YOU HAVE FRIENDS -- */

/* Being able to step through your application in a debugger is nice:
 * Why not make it so you can step through your _entire_ application,
 * server and client, seamlessly?
 *
 * (also, I'll admit, I just like having everything in the same file)
 *
 * host:
 *  - each of the clients can send messages to it
 *  - it updates at, say, 60hz, and broadcasts updates out to clients.
 *
 * client:
 *  - can send and receive messages from the host
 *  - can't talk directly to other clients
 *  - takes updates from host and draws them on the screen
 *  - also sends input events to the server
 * 
 * We can "send messages" all from within the same browser window,
 * no problem!
 *
 * We just have to keep a couple things in mind:
 *  - these messages have to be the ONLY way we communicate between "host" and client code
 *  - the API we decide on has to be something we can match the websockets API to
 *
 * Other than that, we can come up with any API we like: I like mailboxes.
 * A mailbox is exactly what it sounds like: an array of messages from someone else on the network.
 * (they're a lot more compatible with the localStorage hack than the default node websockets API)
 *
 * Let's try one where clients come up with IDs for themselves, and then communicate with the host like so:
 *  
 *    const bob_id = 42069;
 *    send_host(bob_id, "hi im bob");
 *
 *    // returns zero if the server doesn't have a message for you
 *    const msg = recv_from_host(bob_id);
 *
 * Let's see what it looks like to implement a version of this API
 * that doesn't use websockets, and instead just passes the message
 * along.
 *
 * We'll connect it to an "echo server" that just broadcasts your
 * message to all the other clients.
 */

{
  let host_tick, send_host, recv_from_host;
  {
    const host_state = { 
      players: {},
      mailbox: [],
    };

    send_host = (sender_id, msg) =>
      host_state.mailbox.unshift({ sender_id, msg });
    
    recv_from_host = (sender_id) => {
      /* we won't have messages for a client we've never heard of */
      if (!(sender_id in host_state.players)) {
        /* but we will register you for later */
        host_state.players[sender_id] = { mailbox: [] };
        return 0;
      }

      const mailbox = host_state.players[sender_id].mailbox;

      /* nothing to see here */
      if (mailbox.length == 0) return 0;

      return mailbox.pop();
    }

    host_tick = () => {
      const state = host_state;

      while (state.mailbox.length > 0) {
        const { sender_id, msg } = state.mailbox.pop();
        
        /* you're not in our records, you must be new */
        if (!(sender_id in state.players))
          state.players[sender_id] = { mailbox: [] };

        for (const p_id in state.players) {
          const p = state.players[p_id];
          if (p_id != sender_id)
            p.mailbox.unshift(msg);
        }
      };
    }
  }

  const bob_id = 0;
  const alice_id = 1;

  /* let's simulate a couple ticks ... */
  for (let tick = 0; tick < 3; tick++) {
    host_tick();

    let msg;
    while (msg = recv_from_host(alice_id))
      console.log('alice got "' + msg + '"');

    send_host(bob_id, "hi from bob!");
  }
}

/* basically, if our server is just a "host" function,
 * we can pass actual networking messages into it from node,
 *
 * or we can pass it messages that originated from the exact
 * same browser window.
 *
 * the difference is negligible!
 *
 * Let's try something that actuallys looks like a game server now. */

let host_tick, send_host, recv_from_host;
if ((BROWSER && BROWSER_HOST) || NODE) {
  const host_state = {
    tick: 0,
    particles: [],
    mailbox: [],
    players: {},
    sprinklers: [
      { x: 0.5, y: 0.5 },
    ],
  };
  send_host = (sender_id, msg) =>
    host_state.mailbox.unshift({ sender_id, msg });
  
  recv_from_host = (sender_id) => {
    /* we won't have messages for a client we've never heard of */
    if (!(sender_id in host_state.players)) {
      /* but we will register you for later */
      host_state.players[sender_id] = { mailbox: [] };
      return 0;
    }

    const mailbox = host_state.players[sender_id].mailbox;

    /* nothing to see here */
    if (mailbox.length == 0) return 0;

    return mailbox.pop();
  }

  host_tick = () => {
    const state = host_state;

    while (state.mailbox.length > 0) {
      const { sender_id, msg } = state.mailbox.pop();

        /* you're not in our records, you must be new */
        if (!(sender_id in state.players))
          state.players[sender_id] = { mailbox: [] };

      const [type, payload] = JSON.parse(msg);

      if (type == "sprinkler_place") {
        const { x, y } = payload;
        state.sprinklers.push({ x, y })
      }
    }

    {
      /* discard the fields we don't want to send them */
      const { tick, sprinklers } = state;
      const particles = state.particles.map(({ x, y, death_tick }) => {
        const ttl = death_tick - state.tick;
        return { x, y, ttl };
      });

      for (const p_id in state.players) {
        const p = state.players[p_id];
        p.mailbox.unshift(JSON.stringify([
          "tick",
          { tick, sprinklers, particles }
        ]));
      }
    }

    state.tick++;

    for (const sprink of state.sprinklers) {
      /* ten times a second, sprinklers spawn particles */
      if ((state.tick % SECOND_IN_TICKS/10) == 0) {
        state.particles.push({
          x: sprink.x,
          y: sprink.y,
          death_tick: state.tick + SECOND_IN_TICKS*10,

          /* turn the current tick into an angle,
           * and from an angle into a velocity vector. */
          vx: Math.cos(state.tick + sprink.x*10),
          vy: Math.sin(state.tick + sprink.y*10),
        });
      }
    }

    state.particles = state.particles.filter(part => {
      /* should be straight forward */
      part.x += part.vx * 0.003;
      part.y += part.vy * 0.003;

      /* wrap around the edges pacman style */
      if (part.x < 0) part.x = 1 - Math.abs(part.x);
      if (part.x > 1) part.x = part.x - 1;
      if (part.y < 0) part.y = 1 - Math.abs(part.y);
      if (part.y > 1) part.y = part.y - 1;

      return part.death_tick >= state.tick;
    });
  }
} else if (BROWSER) {
  host_tick = () => {};

  /* supports multiple sockets purely for splitscreen */
  send_host      = (id, msg) => socket(id).send_host(msg);
  recv_from_host = (id) => socket(id).recv_from_host();

  let sockets = {};
  function socket(id) {
    if (id in sockets) return sockets[id];

    let ret = sockets[id] = {};

    /* hold in messages until the websocket opens */
    let outbox = [];
    ret.send_host = msg => outbox.unshift(msg);
    ret.recv_from_host = () => 0;

    const ws = new WebSocket("ws://localhost:8080");
    ws.onopen = () => {
      console.log("socket open!");

      for (const msg of outbox) ws.send(msg);
      ret.send_host = msg => ws.send(msg);

      let inbox = [];
      ws.onmessage = (msg) => inbox.unshift(msg.data);
      ret.recv_from_host = () => inbox.length && inbox.pop();
    }

    return ret;
  }
}

if (NODE) {
  const port = 8080;

  const express = require('express');
  const ws = require('ws');
  const app = express();
  app.use(express.static('./'))
  const wss = new ws.Server({ noServer: true });
  const server = app.listen(8080);
  console.log('Listening on port ' + port)
  server.on('upgrade', (...args) => wss.handleUpgrade(...args, connect));

  let id_gen = 0;
  let clients = {};
  function connect(ws) {
    const id = id_gen++;
    console.log("connect! id: " + id);
    clients[id] = ws;

    ws.on('message', (data, isBinary) => {
      console.log('msg', data.toString());
      send_host(id, data.toString())
    });
  }

      /*
      for (const client of wss.clients)
        if (client !== ws && client.readyState === ws.OPEN)
          client.send(data, { binary: isBinary });
          */

  setInterval(() => {
    host_tick();

    let msg;
    for (const id in clients)
      while (msg = recv_from_host(id)) {
        if (clients[id].readyState === ws.OPEN)
          clients[id].send(msg);
      }
  }, 1000/50);
}

const defaultState = () => ({
  id: Math.floor(Math.random() * 99999999999),
  world: {
    sprinklers: [],
    particles: [],
    tick: 0
  }
});

let state = SPLITSCREEN
  ? [defaultState(), defaultState()]
  : defaultState();
if (BROWSER) window.onload = function frame() {
  requestAnimationFrame(frame);

  if (SPLITSCREEN) {
    const p1 = document.getElementById("player1");
    const p2 = document.getElementById("player2");
    p2.width  = p1.width  = window.innerWidth;
    p2.height = p1.height = window.innerHeight / 2;

    /* fix gap between the two? fuck CSS */
    p2.style.position = 'absolute';
    p2.style.bottom = '0px';
    p2.style.left = '0px';

    client(p1, state[0]);
    client(p2, state[1]);
  } else {
    const p1 = document.getElementById("player1");
    p1.width  = window.innerWidth;
    p1.height = window.innerHeight;
    client(p1, state[0]);
  }

  host_tick();
}

function client(canvas, state) {
  const id = state.id;

  /* send messages to server */
  canvas.onmousedown = ({ offsetX: x, offsetY: y }) => {
    x /= canvas.width;
    y /= canvas.width;
    send_host(id, JSON.stringify(["sprinkler_place", { x, y }]));
  }

  /* take messages from server */
  let msg;
  while (msg = recv_from_host(id)) {
    const [type, payload] = JSON.parse(msg);

    if (type == "tick")
      state.world = payload;
  }

  render(canvas, state.world);
}

function render(canvas, world) {
  /* initialize canvas */
  const ctx = canvas.getContext("2d");

  /* clear canvas */
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save(); {
    /* make the window wider, it'll zoom.
     * make the window longer, it'll just show more.
     *
     * also, instead of pixels the units are now "screen widths" */
    ctx.scale(canvas.width, canvas.width);

    /* fill in background */
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, 1, 1);

    for (const { x, y } of world.sprinklers) {
      const size = 0.05;
      ctx.fillStyle = "blue";
      ctx.fillRect(x - size/2, y - size/2, size, size);
    }
    for (const { x, y, death_tick } of world.particles) {
      const size = 0.01;

      /* canvas treats alphas > 1 the same as 1 */
      const ttl = death_tick - world.tick;
      ctx.globalAlpha = ttl / SECOND_IN_TICKS;

      ctx.fillStyle = "purple";
      ctx.fillRect(x - size/2, y - size/2, size, size);

      /* bad things happen if you forget to reset this */
      ctx.globalAlpha = 1.0;
    }

  }; ctx.restore();
}
