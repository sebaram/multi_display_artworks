export function createSocketClient(ioFactory, handlers) {
  const registeredHandlers = Object.entries(handlers);
  let socket = null;

  return {
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
