import { UserRepository } from "./UserRepository.js";

export const AuthService = {
  createUser(name: string) {
    return UserRepository.insert(name);
  },
};
