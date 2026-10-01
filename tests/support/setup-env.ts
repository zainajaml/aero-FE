import { inject } from "vitest";
import { testEnv } from "./global-setup.js";

Object.assign(process.env, testEnv(inject("databaseUrl")));
