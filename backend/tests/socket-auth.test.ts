import { io as Client } from 'socket.io-client';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

describe('Socket.io Dispatcher Authentication Security', () => {
  let io: Server;
  let clientSocket: any;
  let httpServer: any;
  let port: number;

  const TEST_SECRET = 'test-secret-key';
  process.env.JWT_SECRET = TEST_SECRET;

  beforeAll((done) => {
    // Spin up an isolated test server to avoid EADDRINUSE conflicts with the real dev server
    httpServer = createServer();
    io = new Server(httpServer);

    // Replicate the exact auth middleware from server.ts
    io.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      if (token) {
        if (!process.env.JWT_SECRET) return next(new Error('Server misconfiguration: missing JWT_SECRET'));
        try {
          const decoded: any = jwt.verify(token, process.env.JWT_SECRET);
          socket.data.dispatcherId = decoded.dispatcherId;
          socket.data.role = decoded.role;
        } catch {
          return next(new Error("unauthorized"));
        }
      }
      next();
    });

    // Replicate the join_incident logic
    io.on('connection', (socket) => {
      socket.on('join_incident', (payload) => {
        // SECURITY CONSTRAINT: Only verified dispatchers can join location streams
        if (socket.data.role !== 'DISPATCHER') {
          // Silently reject, or emit an error back for testing purposes
          socket.emit('error', 'Unauthorized join attempt');
          return;
        }
        socket.join(payload.incidentId);
        socket.emit('joined', payload.incidentId);
      });
    });

    httpServer.listen(() => {
      port = httpServer.address().port;
      done();
    });
  });

  afterAll(() => {
    io.close();
    clientSocket?.close();
  });

  afterEach(() => {
    if (clientSocket) {
      clientSocket.close();
    }
  });

  test('Unauthenticated socket (no token) cannot join an incident room', (done) => {
    clientSocket = Client(`http://localhost:${port}`);

    clientSocket.on('connect', () => {
      // Attempt to join as a dispatcher without a token
      clientSocket.emit('join_incident', { incidentId: 'GLOBAL_TEST_INCIDENT' });
    });

    clientSocket.on('error', (msg: string) => {
      expect(msg).toBe('Unauthorized join attempt');
      done();
    });

    clientSocket.on('joined', () => {
      done(new Error('Unauthenticated socket was allowed to join the room!'));
    });
  });

  test('Socket with tampered/expired token gets rejected by middleware', (done) => {
    clientSocket = Client(`http://localhost:${port}`, {
      auth: { token: 'this-is-a-fake-tampered-token' }
    });

    clientSocket.on('connect_error', (err: any) => {
      expect(err.message).toBe('unauthorized');
      done();
    });

    clientSocket.on('connect', () => {
      done(new Error('Socket with tampered token was allowed to connect!'));
    });
  });

  test('Socket with valid Dispatcher JWT CAN join an incident room', (done) => {
    const validToken = jwt.sign({ dispatcherId: '123', role: 'DISPATCHER' }, TEST_SECRET, { expiresIn: '1h' });
    
    clientSocket = Client(`http://localhost:${port}`, {
      auth: { token: validToken }
    });

    clientSocket.on('connect', () => {
      clientSocket.emit('join_incident', { incidentId: 'GLOBAL_TEST_INCIDENT' });
    });

    clientSocket.on('joined', (roomId: string) => {
      expect(roomId).toBe('GLOBAL_TEST_INCIDENT');
      done();
    });

    clientSocket.on('error', (msg: string) => {
      done(new Error(`Valid token was rejected: ${msg}`));
    });
  });
});
