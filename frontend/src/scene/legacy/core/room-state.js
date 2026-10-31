export function createRoomState(selfId) {
  const usersById = new Map();

  function applyUser(user) {
    if (!user?.userId || user.userId === selfId) return;
    const merged = {
      ...(usersById.get(user.userId) ?? {}),
      ...user,
    };
    if (Object.hasOwn(user, 'avatarId') && !Object.hasOwn(user, 'appearance')) delete merged.appearance;
    usersById.set(user.userId, merged);
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
