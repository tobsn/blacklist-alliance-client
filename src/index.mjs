// ESM wrapper for the Blacklist Alliance client
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const {
	BlacklistAlliance,
	BlacklistAllianceError,
	AuthenticationError,
	RateLimitError,
	ValidationError,
	TimeoutError,
	NetworkError,
	ServerError,
	CircuitBreakerError,
} = require("./index.js");

export {
	BlacklistAlliance,
	BlacklistAllianceError,
	AuthenticationError,
	RateLimitError,
	ValidationError,
	TimeoutError,
	NetworkError,
	ServerError,
	CircuitBreakerError,
};

export default BlacklistAlliance;
