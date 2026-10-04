const os = require('node:os');
const { createApplication } = require('./src/app');

function startServer(
  port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || '0.0.0.0'
) {
  const application = createApplication();
  application.server.listen(port, host, () => {
    const actualPort = application.server.address().port;
    console.log('Дурак: http://localhost:' + actualPort);
    for (const interfaces of Object.values(os.networkInterfaces())) {
      for (const info of interfaces || []) {
        if (info.family === 'IPv4' && !info.internal)
          console.log('LAN: http://' + info.address + ':' + actualPort);
      }
    }
  });
  return application;
}
if (require.main === module) {
  const application = startServer();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    application
      .close()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
module.exports = { startServer };
