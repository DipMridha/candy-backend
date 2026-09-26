const express = require("express");  
const cors = require("cors");  
const admin = require("firebase-admin");  
const { AccessToken, RoomServiceClient } = require("livekit-server-sdk");  
  
const app = express();  
  
app.use(cors());  
app.use(express.json());  
  
// =====================================================  
// FIREBASE ADMIN  
// =====================================================  
  
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;  
  
if (!serviceAccountJson) {  
  console.error(  
    "[Firebase] FIREBASE_SERVICE_ACCOUNT_JSON is missing"  
  );  
  process.exit(1);  
}  
  
let serviceAccount;  
  
try {  
  serviceAccount = JSON.parse(serviceAccountJson);  
} catch (error) {  
  console.error(  
    "[Firebase] Invalid FIREBASE_SERVICE_ACCOUNT_JSON:",  
    error.message  
  );  
  process.exit(1);  
}  
  
admin.initializeApp({  
  credential: admin.credential.cert(serviceAccount),  
  databaseURL:  
    "https://candy-diprima-default-rtdb.firebaseio.com"  
});  
  
const db = admin.database();  
const auth = admin.auth();  
  
// =====================================================  
// FIREBASE AUTH MIDDLEWARE  
// =====================================================  
  
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
    console.error("[Auth] Verification error:", error.message);  
  
    return res.status(401).json({  
      status: "error",  
      message: "Invalid Firebase ID token"  
    });  
  }  
}  
  
// =====================================================  
// HOME  
// =====================================================  
  
app.get("/", (req, res) => {  
  res.json({  
    status: "ok",  
    message: "Candy backend is running"  
  });  
});  
  
// =====================================================  
// FIREBASE TEST  
// =====================================================  
  
app.get("/firebase-test", async (req, res) => {  
  try {  
    await auth.listUsers(1);  
  
    return res.json({  
      status: "ok",  
      firebase: "connected"  
    });  
  } catch (error) {  
    console.error(  
      "[Firebase] Connection error:",  
      error.message  
    );  
  
    return res.status(500).json({  
      status: "error",  
      firebase: "connection failed",  
      message: error.message  
    });  
  }  
});  
  
// =====================================================  
// FIND CHAT  
// =====================================================  
  
app.post("/find", verifyUser, async (req, res) => {  
  const uid = req.uid;  
  
  try {  
    const queueRef = db.ref("matchQueue");  
  
    const existing = await queueRef  
      .child(uid)  
      .once("value");  
  
    // Already waiting  
    if (existing.exists()) {  
      return res.json({  
        status: "waiting",  
        uid: uid  
      });  
    }  
  
    const snapshot = await queueRef.once("value");  
    const queue = snapshot.val() || {};  
  
    let otherUid = null;  
  
    for (const waitingUid of Object.keys(queue)) {  
      if (waitingUid !== uid) {  
        otherUid = waitingUid;  
        break;  
      }  
    }  
  
    // =================================================  
    // NO PARTNER FOUND  
    // =================================================  
  
    if (!otherUid) {  
      await queueRef.child(uid).set({  
        uid: uid,  
        status: "waiting",  
        createdAt:  
          admin.database.ServerValue.TIMESTAMP  
      });  
  
      return res.json({  
        status: "waiting",  
        uid: uid  
      });  
    }  
  
    // =================================================  
    // MATCH FOUND  
    // =================================================  
  
    const matchId = db  
      .ref("matches")  
      .push()  
      .key;  
  
    if (!matchId) {  
      throw new Error(  
        "Unable to generate match ID"  
      );  
    }  
  
    const matchData = {  
      matchId: matchId,  
      user1: otherUid,  
      user2: uid,  
      status: "matched",  
      createdAt:  
        admin.database.ServerValue.TIMESTAMP  
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
      `[MATCH] CREATED: ${otherUid} <-> ${uid} | ${matchId}`  
    );  
  
    return res.json({  
      status: "matched",  
      matchId: matchId,  
      matchedWith: otherUid  
    });  
  
  } catch (error) {  
    console.error(  
      "[MATCH] Find error:",  
      error.message  
    );  
  
    return res.status(500).json({  
      status: "error",  
      message: error.message  
    });  
  }  
});  
  
// =====================================================  
// MATCH STATUS  
// =====================================================  
  
app.get(  
  "/match-status",  
  verifyUser,  
  async (req, res) => {  
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
      console.error(  
        "[MATCH] Status error:",  
        error.message  
      );  
  
      return res.status(500).json({  
        status: "error",  
        message: error.message  
      });  
    }  
  }  
);  
  
// =====================================================  
// CANCEL FIND  
// =====================================================  
  
app.post(  
  "/cancel",  
  verifyUser,  
  async (req, res) => {  
    const uid = req.uid;  
  
    try {  
      await db  
        .ref(`matchQueue/${uid}`)  
        .remove();  
  
      return res.json({  
        status: "cancelled"  
      });  
  
    } catch (error) {  
      console.error(  
        "[MATCH] Cancel error:",  
        error.message  
      );  
  
      return res.status(500).json({  
        status: "error",  
        message: error.message  
      });  
    }  
  }  
);  
  
// =====================================================  
// LIVEKIT VIDEO TOKEN  
// =====================================================  
  
app.post("/video/token", async (req, res) => {  
  try {  
    const {  
      roomName,  
      userId,  
      username  
    } = req.body;  
  
    console.log(  
      `[LiveKit] Token request: room=${roomName}, user=${userId}`  
    );  
  
    // -------------------------------------------------  
    // Validate request  
    // -------------------------------------------------  
  
    if (!roomName || !userId) {  
      return res.status(400).json({  
        success: false,  
        error:  
          "roomName and userId are required"  
      });  
    }  
  
    // -------------------------------------------------  
    // Read environment variables  
    // -------------------------------------------------  
  
    const apiKey =  
      process.env.LIVEKIT_API_KEY;  
  
    const apiSecret =  
      process.env.LIVEKIT_API_SECRET;  
  
    const livekitUrl =  
      process.env.LIVEKIT_URL;  
  
    // -------------------------------------------------  
    // Validate environment variables  
    // -------------------------------------------------  
  
    if (!apiKey || !apiSecret || !livekitUrl) {  
      console.error(  
        "[LiveKit] Missing environment variables"  
      );  
  
      console.error(  
        `[LiveKit] API_KEY exists: ${Boolean(apiKey)}`  
      );  
  
      console.error(  
        `[LiveKit] API_SECRET exists: ${Boolean(apiSecret)}`  
      );  
  
      console.error(  
        `[LiveKit] URL exists: ${Boolean(livekitUrl)}`  
      );  
  
      return res.status(500).json({  
        success: false,  
        error:  
          "LiveKit server configuration missing"  
      });  
    }  
  
    // -------------------------------------------------  
    // Validate WebSocket URL  
    // -------------------------------------------------  
  
    if (  
      !livekitUrl.startsWith("wss://") &&  
      !livekitUrl.startsWith("ws://")  
    ) {  
      console.error(  
        "[LiveKit] Invalid LIVEKIT_URL. It must start with wss://"  
      );  
  
      return res.status(500).json({  
        success: false,  
        error:  
          "Invalid LIVEKIT_URL configuration"  
      });  
    }  
  
    // -------------------------------------------------  
    // Parse LiveKit hostname safely  
    // -------------------------------------------------  
  
    let livekitHostname = "unknown";  
  
    try {  
      livekitHostname =  
        new URL(livekitUrl).hostname;  
    } catch (error) {  
      console.error(  
        "[LiveKit] Invalid URL:",  
        error.message  
      );  
  
      return res.status(500).json({  
        success: false,  
        error:  
          "Invalid LIVEKIT_URL configuration"  
      });  
    }  
  
    // -------------------------------------------------  
    // Safe API key diagnostic  
    // NEVER log API secret  
    // -------------------------------------------------  
  
    const apiKeyPrefix =  
      apiKey.length >= 4  
        ? `${apiKey.substring(0, 4)}...`  
        : "****";  
  
    console.log(  
      `[CANDY_DIAGNOSTIC] LIVEKIT hostname: ${livekitHostname}`  
    );  
  
    console.log(  
      `[CANDY_DIAGNOSTIC] LIVEKIT API key prefix: ${apiKeyPrefix}`  
    );  
  
    console.log(  
      `[CANDY_DIAGNOSTIC] LIVEKIT API secret exists: ${Boolean(apiSecret)}`  
    );  
  
    // -------------------------------------------------  
    // Generate LiveKit Access Token  
    // -------------------------------------------------  
  
    const at = new AccessToken(  
      apiKey,  
      apiSecret,  
      {  
        identity: userId,  
        name: username || "Candy User",  
        ttl: "10m"  
      }  
    );  
  
    // -------------------------------------------------  
    // Room permissions  
    // -------------------------------------------------  
  
    at.addGrant({  
      room: roomName,  
      roomJoin: true,  
      canPublish: true,  
      canSubscribe: true  
    });  
  
    // -------------------------------------------------  
    // Generate JWT  
    // -------------------------------------------------  
  
    const token = await at.toJwt();  
  
    if (!token || typeof token !== "string") {  
      throw new Error(  
        "LiveKit SDK returned an invalid token"  
      );  
    }  
  
    // =================================================  
    // SAFE JWT DIAGNOSTICS  
    // =================================================  
  
    try {  
      const parts = token.split(".");  
  
      if (parts.length !== 3) {  
        throw new Error(  
          "Generated JWT does not have 3 parts"  
        );  
      }  
  
      const payloadJson =  
        Buffer.from(  
          parts[1],  
          "base64"  
        ).toString("utf8");  
  
      const payload =  
        JSON.parse(payloadJson);  
  
      const issuerMatches =  
        payload.iss === apiKey;  
  
      const subjectMatches =  
        payload.sub === userId;  
  
      const grant =  
        payload.video || {};  
  
      const roomMatches =  
        grant.room === roomName;  
  
      const expiration =  
        Number(payload.exp || 0);  
  
      const currentTime =  
        Math.floor(Date.now() / 1000);  
  
      const expirationValid =  
        expiration > currentTime;  
  
      console.log(  
        "=============================================="  
      );  
  
      console.log(  
        "[CANDY_DIAGNOSTIC] LIVEKIT TOKEN"  
      );  
  
      console.log(  
        `[CANDY_DIAGNOSTIC] URL hostname: ${livekitHostname}`  
      );  
  
      console.log(  
        `[CANDY_DIAGNOSTIC] JWT issuer matches API key: ${issuerMatches}`  
      );  
  
      console.log(  
        `[CANDY_DIAGNOSTIC] JWT subject matches userId: ${subjectMatches}`  
      );  
  
      console.log(  
        `[CANDY_DIAGNOSTIC] JWT exp valid: ${expirationValid}`  
      );  
  
      console.log(  
        `[CANDY_DIAGNOSTIC] Requested room: ${roomName}`  
      );  
  
      console.log(  
        `[CANDY_DIAGNOSTIC] JWT grant room matches: ${roomMatches}`  
      );  
  
      console.log(  
        `[CANDY_DIAGNOSTIC] roomJoin: ${grant.roomJoin}`  
      );  
  
      console.log(  
        `[CANDY_DIAGNOSTIC] canPublish: ${grant.canPublish}`  
      );  
  
      console.log(  
        `[CANDY_DIAGNOSTIC] canSubscribe: ${grant.canSubscribe}`  
      );  
  
      console.log(  
        `[CANDY_DIAGNOSTIC] JWT token generated: true`  
      );  
  
      console.log(  
        "=============================================="  
      );  
  
      if (!issuerMatches) {  
        console.error(  
          "[CANDY_DIAGNOSTIC] CRITICAL: JWT issuer does NOT match LIVEKIT_API_KEY."  
        );  
      }  
  
      if (!subjectMatches) {  
        console.error(  
          "[CANDY_DIAGNOSTIC] CRITICAL: JWT subject does NOT match requested userId."  
        );  
      }  
  
      if (!expirationValid) {  
        console.error(  
          "[CANDY_DIAGNOSTIC] CRITICAL: JWT expiration is invalid or already expired."  
        );  
      }  
  
      if (!roomMatches) {  
        console.error(  
          "[CANDY_DIAGNOSTIC] CRITICAL: JWT room does NOT match requested room."  
        );  
      }  
  
      if (grant.roomJoin !== true) {  
        console.error(  
          "[CANDY_DIAGNOSTIC] CRITICAL: roomJoin is not true."  
        );  
      }  
  
      if (grant.canPublish !== true) {  
        console.error(  
          "[CANDY_DIAGNOSTIC] WARNING: canPublish is not true."  
        );  
      }  
  
      if (grant.canSubscribe !== true) {  
        console.error(  
          "[CANDY_DIAGNOSTIC] WARNING: canSubscribe is not true."  
        );  
      }  
  
    } catch (diagnosticError) {  
      console.error(  
        "[CANDY_DIAGNOSTIC] JWT decode error:",  
        diagnosticError.message  
      );  
    }  
  
    // =================================================  
    // SEND TOKEN TO ANDROID  
    // =================================================  
  
    console.log(  
      `[LiveKit] Token generated successfully for user=${userId}, room=${roomName}`  
    );  
  
    return res.status(200).json({  
      success: true,  
      token: token,  
      serverUrl: livekitUrl  
    });  
  
  } catch (error) {  
    console.error(  
      "[LiveKit] Token generation error:",  
      error.message  
    );  
  
    return res.status(500).json({  
      success: false,  
      error:  
        "Failed to generate LiveKit token"  
    });  
  }  
});  
  
// =====================================================  
// LIVEKIT DIAGNOSTIC TEST ROUTE  
// =====================================================  
  
app.get("/livekit-test", async (req, res) => {  
  try {  
    const livekitUrl = process.env.LIVEKIT_URL;  
    const apiKey = process.env.LIVEKIT_API_KEY;  
    const apiSecret = process.env.LIVEKIT_API_SECRET;  
  
    if (!livekitUrl || !apiKey || !apiSecret) {  
      return res.status(500).json({  
        success: false,  
        error: "Missing LiveKit environment variables"  
      });  
    }  
  
    const host = livekitUrl  
      .replace(/^wss:\/\//, "https://")  
      .replace(/^ws:\/\//, "http://")  
      .replace(/\/$/, "");  
  
    const roomService = new RoomServiceClient(  
      host,  
      apiKey,  
      apiSecret  
    );  
  
    const rooms = await roomService.listRooms();  
  
    return res.json({  
      success: true,  
      hostname: new URL(livekitUrl).hostname,  
      apiKeyPrefix: apiKey.substring(0, 4) + "...",  
      apiAuth: "SUCCESS",  
      roomCount: rooms.length  
    });  
  
  } catch (err) {  
    let hostname = "INVALID_URL";  
  
    try {  
      hostname = new URL(process.env.LIVEKIT_URL || "").hostname;  
    } catch (_) {}  
  
    console.error("[CANDY_LIVEKIT_TEST] FAILED:", err.message);  
  
    return res.status(500).json({  
      success: false,  
      hostname,  
      apiAuth: "FAILED",  
      error: err.message  
    });  
  }  
});  
  
// =====================================================  
// SERVER  
// =====================================================  
  
const PORT =  
  process.env.PORT || 3000;  
  
app.listen(PORT, () => {  
  console.log(  
    `Candy backend running on port ${PORT}`  
  );  
  
  console.log(  
    `[LiveKit] Token endpoint: /video/token`  
  );  
});
