import { serve } from "https://deno.land/std@0.114.0/http/server.ts";
function generateGUID(webCrypto: boolean = true): string {
  const useWebCrypto = webCrypto && "crypto" in window &&
    "getRandomValues" in crypto;

  // @ts-ignore
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(
    /[018]/g,
    (c: number) =>
      (c ^
        (useWebCrypto
            ? crypto.getRandomValues(new Uint8Array(1))[0]
            : Math.floor(256 * Math.random())) & 15 >> c / 4).toString(16),
  );
}

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

function joinRoom(roomName: string) {
  if (openRooms.has(roomName)) {
    const peerId = generateGUID();

    // First one to join room is host.
    if (openRooms.get(roomName) === null) {
      openRooms.set(roomName, peerId);
    }

    const channel = new BroadcastChannel(roomName);

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

function createRoom(roomName: string) {
  if (openRooms.has(roomName)) {
    throw new Error("Room exists");
  } else {
    openRooms.set(roomName, null);
  }
}

function emitInRoom(roomName: string, event: { type: string; value: any }) {
  const channel = new BroadcastChannel(roomName);
  channel.postMessage(event);
}

function okResponse(message: string) {
  return new Response(message, {
    status: 200,
  });
}

function errorResponse(e: Error) {
  return new Response(e.message, {
    status: 500,
  });
}

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let filePath = "./src" + url.pathname;
  filePath = filePath === "./src/" ? "./src/index.html" : filePath;

  if (url.pathname === "/station") {
    filePath = "src/station.html";
  }

  if (url.pathname.includes("/room/")) {
    const [, , roomName, sse] = url.pathname.split("/");

    if (roomName && request.method === "GET" && sse === "sse") {
      try {
        return joinRoom(roomName);
      } catch (e) {
        return errorResponse(e);
      }
    }

    if (roomName && request.method === "POST" && sse === "sse") {
      const event = await request.json();

      emitInRoom(roomName, event);

      return new Response("OK", {
        status: 200,
      });
    }

    if (roomName === "create" && request.method === "POST") {
      try {
        const roomId = generateGUID();

        createRoom(roomId);

        return new Response(
          JSON.stringify({
            roomId,
          }),
          {
            headers: {
              "Cache-Control": "no-cache",
              "Content-Type": mime(".json"),
            },
          },
        );
      } catch (e) {
        return errorResponse(e);
      }
    }
  } else {
    try {
      const file = await Deno.readFile(filePath);
      const contentType = mime(filePath);

      return new Response(file, {
        headers: {
          "Content-Type": contentType,
        },
      });
    } catch (e) {
      return errorResponse(e);
    }
  }

  return errorResponse(new Error("Not found"));
}

console.log("App is running at http://localhost:8000/station");

await serve(handler);
