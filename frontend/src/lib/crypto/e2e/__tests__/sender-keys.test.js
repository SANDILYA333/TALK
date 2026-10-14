import test from "node:test";
import assert from "node:assert/strict";

import {
  createSenderKeyState,
  encryptSenderKeyMessage,
  decryptSenderKeyMessage,
} from "../sender-keys.js";

test.describe("TALK Feature 7 — Group Messaging with Sender Keys Suite", () => {
  const groupId = "grp_crypto_hackers_1";

  test("1. Initializes sender key state with chain key and Ed25519 signing keypair", async () => {
    const state = await createSenderKeyState(groupId, 1);
    assert.equal(state.groupId, groupId);
    assert.equal(state.epoch, 1);
    assert.equal(state.iteration, 0);
    assert.equal(state.chainKeyHex.length, 64, "Chain key must be 32 bytes hex");
    assert(state.signingPublicKeyHex, "Must generate signing public key");
    assert(state.signingPrivateKeyHex, "Must generate signing private key");
  });

  test("2. Encrypts and decrypts group message successfully", async () => {
    const senderState = await createSenderKeyState(groupId, 1);

    // Initial receiver record shared via pairwise session
    let receiverRecord = {
      groupId,
      epoch: 1,
      iteration: 0,
      chainKeyHex: senderState.chainKeyHex,
      signingPublicKeyHex: senderState.signingPublicKeyHex,
    };

    const secretText = "Hello Group Members! Meeting at 15:00 UTC";
    const { envelope, updatedState } = await encryptSenderKeyMessage({
      plaintext: secretText,
      senderState,
      groupId,
    });

    assert.equal(envelope.protocol, "TALK-SENDERKEY-V1");
    assert.equal(envelope.iteration, 0);
    assert.equal(updatedState.iteration, 1);

    const { plaintext, updatedRecord } = await decryptSenderKeyMessage({
      envelope,
      remoteSenderRecord: receiverRecord,
    });

    assert.equal(plaintext, secretText);
    assert.equal(updatedRecord.iteration, 1);
  });

  test("3. Encrypts multiple consecutive messages with sequential chain advancement", async () => {
    let senderState = await createSenderKeyState(groupId, 1);
    let receiverRecord = {
      groupId,
      epoch: 1,
      iteration: 0,
      chainKeyHex: senderState.chainKeyHex,
      signingPublicKeyHex: senderState.signingPublicKeyHex,
    };

    const messages = ["Group msg 1", "Group msg 2", "Group msg 3"];

    for (const msg of messages) {
      const res = await encryptSenderKeyMessage({
        plaintext: msg,
        senderState,
        groupId,
      });
      senderState = res.updatedState;

      const dec = await decryptSenderKeyMessage({
        envelope: res.envelope,
        remoteSenderRecord: receiverRecord,
      });
      receiverRecord = dec.updatedRecord;

      assert.equal(dec.plaintext, msg);
    }

    assert.equal(senderState.iteration, 3);
    assert.equal(receiverRecord.iteration, 3);
  });

  test("4. Strictly rejects tampered ciphertext or signature", async () => {
    const senderState = await createSenderKeyState(groupId, 1);
    const receiverRecord = {
      groupId,
      epoch: 1,
      iteration: 0,
      chainKeyHex: senderState.chainKeyHex,
      signingPublicKeyHex: senderState.signingPublicKeyHex,
    };

    const { envelope } = await encryptSenderKeyMessage({
      plaintext: "Original text",
      senderState,
      groupId,
    });

    // Tamper with ciphertext
    const tamperedCiphertext =
      (envelope.ciphertextHex.slice(0, 2) === "00" ? "ff" : "00") +
      envelope.ciphertextHex.slice(2);

    const tamperedEnvelope = {
      ...envelope,
      ciphertextHex: tamperedCiphertext,
    };

    await assert.rejects(
      async () => {
        await decryptSenderKeyMessage({
          envelope: tamperedEnvelope,
          remoteSenderRecord: receiverRecord,
        });
      },
      /Invalid sender key signature/
    );
  });

  test("5. Rejects messages with epoch mismatch (Key Rotation Invariant)", async () => {
    const senderState = await createSenderKeyState(groupId, 2); // Sender on epoch 2
    const receiverRecord = {
      groupId,
      epoch: 1, // Receiver on old epoch 1
      iteration: 0,
      chainKeyHex: senderState.chainKeyHex,
      signingPublicKeyHex: senderState.signingPublicKeyHex,
    };

    const { envelope } = await encryptSenderKeyMessage({
      plaintext: "Secret after member removal",
      senderState,
      groupId,
    });

    await assert.rejects(
      async () => {
        await decryptSenderKeyMessage({
          envelope,
          remoteSenderRecord: receiverRecord,
        });
      },
      /Sender key epoch mismatch/
    );
  });
});
