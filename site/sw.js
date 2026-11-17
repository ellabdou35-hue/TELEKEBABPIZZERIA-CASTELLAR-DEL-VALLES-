// Service worker del panel de cocina: permite instalar la app y mostrar avisos del sistema.
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if(c.url.includes('pedidos')&&'focus' in c)return c.focus()}return self.clients.openWindow('./pedidos.html')}))});
// Preparado para Web Push (requiere servidor con claves VAPID; ver SQL/notas).
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data&&e.data.text()}}e.waitUntil(self.registration.showNotification(d.title||'🔴 Nuevo pedido · Tele Kebab',{body:d.body||'Abre el panel de cocina',tag:'tk-new',renotify:true,requireInteraction:true,vibrate:[400,200,400,200,400]}))});
