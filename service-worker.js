/* service-worker.js - Maktabat AlAysaei (PWA Offline Caching) */

// اسم ذاكرة التخزين المؤقت (Cache) ورقم الإصدار.
// تم زيادة الإصدار لضمان أن المتصفح يقوم بتثبيت الأيقونات الجديدة.
const CACHE_NAME = 'maktabat-alaysaei-cache-v4'; 

// قائمة بالملفات الأساسية التي يجب تخزينها مؤقتاً فوراً عند التثبيت
const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  // ملفات الأيقونات المضافة حديثاً
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

/**
 * حدث التثبيت (Install Event): يتم تفعيله عند تثبيت Service Worker لأول مرة.
 * يقوم بفتح ذاكرة التخزين المؤقت وتخزين الملفات الأساسية المدرجة.
 */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching core assets');
        return cache.addAll(CORE_ASSETS);
      })
  );
  // يجبر Service Worker الجديد على تولي التحكم فوراً
  self.skipWaiting(); 
});

/**
 * حدث التنشيط (Activate Event): يتم تفعيله عند تنشيط Service Worker.
 * يقوم بحذف أي إصدارات قديمة لذاكرة التخزين المؤقت (لضمان تحديث الأصول).
 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // تأكيد تولي التحكم للService Worker الجديد
  return self.clients.claim();
});

/**
 * حدث الجلب (Fetch Event): يتم تفعيله عند محاولة المتصفح جلب مورد (مثل ملف).
 * نستخدم استراتيجية "Cache, then Network with fallback" هنا.
 */
self.addEventListener('fetch', event => {
  const req = event.request;

  // تجاهل طلبات POST أو غيرها
  if (req.method !== 'GET') return; 

  event.respondWith(
    // 1. محاولة مطابقة الطلب في ذاكرة التخزين المؤقت
    caches.match(req)
      .then(response => {
        // إذا كان المورد موجوداً في الذاكرة المؤقتة، قم بإرجاعه فوراً
        if (response) {
          return response;
        }

        // 2. إذا لم يكن موجوداً، قم بجلبه من الشبكة
        return fetch(req)
          .then(networkResponse => {
            // تحقق مما إذا كان الاستجابة صالحة
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // 3. تخزين النسخة التي تم جلبها من الشبكة مؤقتاً للإستخدام المستقبلي
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                // تجنب تخزين مسارات Google Analytics أو غيرها من الطرف الثالث
                if (req.url.startsWith(self.location.origin) && !req.url.includes('google-analytics')) {
                    cache.put(req, responseToCache);
                }
              });

            return networkResponse;
          })
          // 4. في حالة فشل الجلب من الشبكة (عدم اتصال)، قم بإرجاع الصفحة الرئيسية
          .catch(() => caches.match('./index.html')) 
      })
  );
});
