import { Router, type IRouter } from "express";

const router: IRouter = Router();

const rooms = new Map<string, {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  lastActivity: number;
  mobileConnected: boolean;
  pcConnected: boolean;
  offer: any | null;
  answer: any | null;
  mobileIce: any[];
  pcIce: any[];
}>();

const ROOM_TTL_MS = 3 * 60 * 60 * 1000;

function touchRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (room) {
    room.lastActivity = Date.now();
  }
}

function cleanupStaleRooms() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      rooms.delete(id);
    }
  }
}

setInterval(cleanupStaleRooms, 5 * 60 * 1000);

function generateRoomId(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < 3; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  if (rooms.has(id)) return generateRoomId();
  return id;
}

router.post("/rooms", (req, res) => {
  const { name } = req.body;
  const roomId = generateRoomId();
  const now = new Date().toISOString();
  rooms.set(roomId, {
    id: roomId,
    name: name || "Sala",
    status: "waiting",
    createdAt: now,
    lastActivity: Date.now(),
    mobileConnected: false,
    pcConnected: false,
    offer: null,
    answer: null,
    mobileIce: [],
    pcIce: [],
  });

  res.status(201).json({
    id: roomId,
    status: "waiting",
    createdAt: now,
    mobileConnected: false,
    pcConnected: false,
  });
});

router.get("/rooms/:roomId", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  res.json({
    id: room.id,
    status: room.status,
    createdAt: room.createdAt,
    mobileConnected: room.mobileConnected,
    pcConnected: room.pcConnected,
  });
});

router.post("/rooms/:roomId/offer", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  room.offer = req.body;
  room.mobileConnected = true;
  room.lastActivity = Date.now();
  if (room.pcConnected) {
    room.status = "connected";
  }

  res.json({ success: true, message: "Offer stored" });
});

router.get("/rooms/:roomId/offer", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  if (!room.offer) {
    res.json({ success: false, message: "No offer yet" });
    return;
  }

  res.json({ success: true, message: "Offer available", ...room.offer });
});

router.post("/rooms/:roomId/answer", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  room.answer = req.body;
  room.pcConnected = true;
  room.lastActivity = Date.now();
  if (room.mobileConnected) {
    room.status = "connected";
  }

  res.json({ success: true, message: "Answer stored" });
});

router.get("/rooms/:roomId/answer", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  if (!room.answer) {
    res.json({ success: false, message: "No answer yet" });
    return;
  }

  res.json({ success: true, message: "Answer available", ...room.answer });
});

router.post("/rooms/:roomId/ice", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const { candidate, sdpMid, sdpMLineIndex, source } = req.body;

  if (source === "mobile") {
    room.mobileIce.push({ candidate, sdpMid, sdpMLineIndex });
  } else {
    room.pcIce.push({ candidate, sdpMid, sdpMLineIndex });
  }
  room.lastActivity = Date.now();

  res.json({ success: true, message: "ICE candidate stored" });
});

router.get("/rooms/:roomId/ice/mobile", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  res.json({ candidates: room.mobileIce });
});

router.get("/rooms/:roomId/ice/pc", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  res.json({ candidates: room.pcIce });
});

export default router;
