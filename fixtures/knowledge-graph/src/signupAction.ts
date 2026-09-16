import { AuthService } from "./AuthService.js";

export function signupAction() {
  return AuthService.createUser("demo");
}
