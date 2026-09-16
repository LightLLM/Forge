/** Maps to users table conceptually. */
export const UserRepository = {
  insert(name: string) {
    return { table: "users", name };
  },
};
