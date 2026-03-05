import { createServer } from "@evjs/runtime/server";

// Import server function modules so they register themselves
import "./api/users.server";

createServer({ port: 3001 });
