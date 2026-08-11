export function createRoomState(selfId) {
  const usersById = new Map();

  function applyUser(user) {
    if (!user?.userId || user.userId === selfId) return;
    usersById.set(user.userId, {
      ...(usersById.get(user.userId) ?? {}),
      ...user,
    });
  }

  return {
    applyRoomState(users) {
      usersById.clear();
      if (Array.isArray(users)) users.forEach(applyUser);
    },
    applyJoin: applyUser,
    applyUpdate: applyUser,
    applyLeave(user) {
      if (user?.userId && user.userId !== selfId) usersById.delete(user.userId);
    },
    users() {
      return [...usersById.values()].map((user) => ({ ...user }));
    },
  };
}
