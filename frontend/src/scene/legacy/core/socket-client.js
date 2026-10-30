export function createSocketClient(ioFactory, handlers) {
  const registeredHandlers = Object.entries(handlers);
  let socket = null;

  return {
    on(eventName, handler) {
      const entry = [eventName, handler];
      registeredHandlers.push(entry);
      socket?.on(eventName, handler);
      return () => {
        socket?.off(eventName, handler);
        const index = registeredHandlers.indexOf(entry);
        if (index >= 0) registeredHandlers.splice(index, 1);
      };
    },
    connect(url, options = {}) {
      if (socket) return;

      socket = ioFactory(url, { ...options, autoConnect: false });
      registeredHandlers.forEach(([eventName, handler]) => {
        socket.on(eventName, handler);
      });
      socket.connect();
    },
    emit(eventName, payload) {
      if (!socket?.connected) return false;
      socket.emit(eventName, payload);
      return true;
    },
    emitVolatile(eventName, payload) {
      if (!socket?.connected || socket.io?.engine?.transport?.writable === false) return false;
      (socket.volatile || socket).emit(eventName, payload);
      return true;
    },
    request(eventName, payload, callback) {
      if (!socket?.connected) return false;
      if (socket.timeout)
        socket.timeout(5000).emit(eventName, payload, (error, response) => {
          if (!error) callback(response);
        });
      else socket.emit(eventName, payload, callback);
      return true;
    },
    destroy() {
      if (!socket) return;
      registeredHandlers.forEach(([eventName, handler]) => {
        socket.off(eventName, handler);
      });
      socket.disconnect();
      socket = null;
    },
  };
}
