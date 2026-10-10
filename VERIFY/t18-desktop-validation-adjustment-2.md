# T18 prelaunch adjustment after immutable installed round b

Round t18-v0170b completed the first five scenario assertions. Its sixth scenario stopped because the driver expected MODEL_FORMAT_UNSUPPORTED for an unsupported tool protocol. The actual installed source correctly returned RECOVERY_TOOL_PROTOCOL_UNSUPPORTED and sent zero target requests. The failed round remains failed-controlled; its 51-entry frozen manifest SHA256 is D791CF1A194400ECF9AA59905250ED285347EC76C010A524DBBA297FD3F738DE.

Before a new label is prepared, the external plan now requires the exact tool rejection code. Inspection of the same reviewed source also pins the image-capability refusal to RECOVERY_IMAGE_CAPABILITY_UNSUPPORTED instead of the old broad pattern. These expectations come from src/takeover.mjs auditHandoffRequest/#auditTools and the documented TAKEOVER_ to RECOVERY_ mapping in src/index.mjs. They do not change Router source, the reviewed 0.17.0 package, fixture behavior, retry bounds, budgets, stream ceiling or run deadline.

Round a and round b will never be relaunched or rewritten. A fresh label, profile, prelaunch plan and execution capture are required. All setup/title Calls remain separately recorded; absent usage remains unknown. Production model requests remain zero.
