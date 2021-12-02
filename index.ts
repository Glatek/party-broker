import { serve } from "https://deno.land/std@0.115.1/http/server.ts";
import { v5 } from "https://deno.land/std@0.115.1/uuid/mod.ts";

function mime(text: string) {
  const ext = text.split(".").pop();

  const dict: Record<string, string> = {
    "js": "text/javascript",
    "json": "application/json",
    "html": "text/html",
    "css": "text/css",
  };

  return ext && ext in dict ? dict[ext] : "text/plain";
}

const textEncoder = new TextEncoder();

const createEvent = (eventName: string, data: Object) =>
  textEncoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);

const openRooms: Map<string, string | null> = new Map();

async function joinRoom(roomId: string) {
  if (openRooms.has(roomId)) {
    const peerId = await v5.generate(
      roomId,
      textEncoder.encode(crypto.randomUUID()),
    );

    // First one to join room is host.
    if (openRooms.get(roomId) === null) {
      openRooms.set(roomId, peerId);
    }

    const channel = new BroadcastChannel(roomId);

    // Connect to room;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(createEvent("id", peerId));
        channel.onmessage = (e) => {
          const body = createEvent(e.data.type, e.data.value);

          controller.enqueue(body);
        };
      },
      cancel() {
        channel.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: new Headers({
        "Connection": "Keep-Alive",
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      }),
    });
  } else {
    throw new Error("Room does not exist");
  }
}

function createRoom(roomId: string) {
  if (openRooms.has(roomId)) {
    throw new Error("Room exists");
  } else {
    openRooms.set(roomId, null);
  }
}

function emitInRoom(roomId: string, event: { type: string; value: any }) {
  const channel = new BroadcastChannel(roomId);
  channel.postMessage(event);
}

function errorResponse(e: Error) {
  return new Response(e.message, {
    status: 500,
  });
}

async function router(request: Request) {
  const url = new URL(request.url);
  let response: Promise<Response> | Response = errorResponse(
    new Error("Not found"),
  );

  if (url.pathname.includes("/room/")) {
    const [, , roomId, sse] = url.pathname.split("/");

    if (request.method === "OPTION") {
      response = new Response("OK", {
        status: 204,
      });
    }

    if (roomId && request.method === "GET" && sse === "sse") {
      response = joinRoom(roomId);
    }

    if (roomId && request.method === "POST" && sse === "sse") {
      const event = await request.json();

      emitInRoom(roomId, event);

      response = new Response("OK", {
        status: 200,
      });
    }

    if (roomId === "create" && request.method === "POST") {
      const roomId = crypto.randomUUID();

      createRoom(roomId);

      response = new Response(
        JSON.stringify({
          roomId,
        }),
        {
          headers: new Headers({
            "Cache-Control": "no-cache",
            "Content-Type": mime(".json"),
          }),
        },
      );
    }
  }

  return response;
}

async function handler(request: Request): Promise<Response> {
  let response: Response;

  try {
    response = await router(request);

    response.headers.append(
      "Access-Control-Allow-Origin",
      "https://feature-party.nightcore.app",
    );
    response.headers.append(
      "Access-Control-Request-Method",
      "POST, GET, OPTIONS",
    );
  } catch (e) {
    response = errorResponse(e);
  }

  return response;
}

console.log("App is running at http://localhost:8000/station");

await serve(handler);
