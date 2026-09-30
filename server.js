const os = require('node:os');
const { createApplication } = require('./src/app');

function startServer(port = Number(process.env.PORT) || 3000) {
  const application = createApplication();
  application.server.listen(port, '0.0.0.0', () => {
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
if (require.main === module) startServer();
module.exports = { startServer };
