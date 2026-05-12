self.addEventListener("push", (event) => {
  const fallback = {
    title: "Review ready",
    body: "A purchase is ready for review.",
    url: "/reviews"
  };
  const data = event.data ? event.data.json() : fallback;
  event.waitUntil(
    self.registration.showNotification(data.title || fallback.title, {
      body: data.body || fallback.body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: data.url || fallback.url, taskId: data.taskId }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/reviews";
  event.waitUntil(clients.openWindow(url));
});
