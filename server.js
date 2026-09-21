const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

// ===============================
// Firebase Admin
// ===============================

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://candy-diprima-default-rtdb.firebaseio.com"
});

const db = admin.database();
const auth = admin.auth();

// ===============================
// Firebase Auth middleware
// ===============================

async function verifyUser(req, res, next) {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({
        status: "error",
        message: "Missing Firebase ID token"
      });
    }

    const token = header.substring(7);
    const decoded = await auth.verifyIdToken(token);

    req.uid = decoded.uid;

    next();
  } catch (error) {
    console.error("Auth error:", error);

    return res.status(401).json({
      status: "error",
      message: "Invalid Firebase ID token"
    });
  }
}

// ===============================
// Home
// ===============================

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Candy backend is running"
  });
});

// ===============================
// Firebase test
// ===============================

app.get("/firebase-test", async (req, res) => {
  try {
    await auth.listUsers(1);

    res.json({
      status: "ok",
      firebase: "connected"
    });
  } catch (error) {
    console.error("Firebase error:", error);

    res.status(500).json({
      status: "error",
      firebase: "connection failed",
      message: error.message
    });
  }
});

// ===============================
// FIND CHAT
// ===============================

app.post("/find", verifyUser, async (req, res) => {
  const uid = req.uid;

  try {
    const queueRef = db.ref("matchQueue");

    // Check if this user is already waiting
    const existing = await queueRef.child(uid).once("value");

    if (existing.exists()) {
      return res.json({
        status: "waiting",
        uid: uid
      });
    }

    // Get current waiting users
    const snapshot = await queueRef.once("value");
    const queue = snapshot.val() || {};

    let otherUid = null;

    for (const waitingUid of Object.keys(queue)) {
      if (waitingUid !== uid) {
        otherUid = waitingUid;
        break;
      }
    }

    // Nobody available -> enter queue
    if (!otherUid) {
      await queueRef.child(uid).set({
        uid: uid,
        status: "waiting",
        createdAt: admin.database.ServerValue.TIMESTAMP
      });

      return res.json({
        status: "waiting",
        uid: uid
      });
    }

    // ===============================
    // MATCH FOUND
    // ===============================

    const matchId = db.ref("matches").push().key;

    const matchData = {
      matchId: matchId,
      user1: otherUid,
      user2: uid,
      status: "matched",
      createdAt: admin.database.ServerValue.TIMESTAMP
    };

    const updates = {};

    updates[`matches/${matchId}`] = matchData;

    updates[`userMatches/${otherUid}`] = {
      matchId: matchId,
      matchedWith: uid,
      status: "matched"
    };

    updates[`userMatches/${uid}`] = {
      matchId: matchId,
      matchedWith: otherUid,
      status: "matched"
    };

    updates[`matchQueue/${otherUid}`] = null;
    updates[`matchQueue/${uid}`] = null;

    await db.ref().update(updates);

    console.log(
      `MATCH CREATED: ${otherUid} <-> ${uid} | ${matchId}`
    );

    return res.json({
      status: "matched",
      matchId: matchId,
      matchedWith: otherUid
    });

  } catch (error) {
    console.error("Find error:", error);

    return res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

// ===============================
// MATCH STATUS
// ===============================

app.get("/match-status", verifyUser, async (req, res) => {
  const uid = req.uid;

  try {
    const snapshot = await db
      .ref(`userMatches/${uid}`)
      .once("value");

    if (!snapshot.exists()) {
      return res.json({
        status: "none"
      });
    }

    return res.json(snapshot.val());

  } catch (error) {
    console.error("Match status error:", error);

    return res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

// ===============================
// CANCEL FIND
// ===============================

app.post("/cancel", verifyUser, async (req, res) => {
  const uid = req.uid;

  try {
    await db.ref(`matchQueue/${uid}`).remove();

    return res.json({
      status: "cancelled"
    });

  } catch (error) {
    console.error("Cancel error:", error);

    return res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

// ===============================
// SERVER
// ===============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Candy backend running on port ${PORT}`);
});
