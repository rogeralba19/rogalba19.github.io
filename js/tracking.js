/**
 * Visitor Tracking Module
 * Rastrea visitas y guarda datos en Firebase
 */

(function() {
    'use strict';

    try {
        // Generate or get visitor ID
        let visitorId = localStorage.getItem('alba_visitor_id');
        if (!visitorId) {
            visitorId = 'v_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('alba_visitor_id', visitorId);
        }

        const visitorRef = db.ref('visitors/' + visitorId);
        const sessionStart = Date.now();

        // Get device info
        function getDeviceInfo() {
            const ua = navigator.userAgent;
            let device = 'desktop';
            let browser = 'Unknown';
            let os = 'Unknown';
            let deviceModel = '';

            // Device type
            if (/Mobile|Android|iPhone|iPad/.test(ua)) {
                device = /iPad|Tablet/.test(ua) ? 'tablet' : 'mobile';
            }

            // Browser
            if (ua.includes('Firefox')) browser = 'Firefox';
            else if (ua.includes('Edg')) browser = 'Edge';
            else if (ua.includes('Chrome')) browser = 'Chrome';
            else if (ua.includes('Safari')) browser = 'Safari';
            else if (ua.includes('Opera')) browser = 'Opera';

            // OS
            if (ua.includes('Windows')) os = 'Windows';
            else if (ua.includes('Mac')) os = 'MacOS';
            else if (ua.includes('Linux') && !ua.includes('Android')) os = 'Linux';
            else if (ua.includes('Android')) os = 'Android';
            else if (ua.includes('iPhone')) os = 'iOS';
            else if (ua.includes('iPad')) os = 'iPadOS';

            // Device model
            const androidMatch = ua.match(/Android[^;]*;\s*([^)]+)\)/);
            if (androidMatch) {
                deviceModel = androidMatch[1].split(' Build')[0].trim();
            }
            if (ua.includes('iPhone')) deviceModel = 'iPhone';
            if (ua.includes('iPad')) deviceModel = 'iPad';

            // Additional capabilities
            const deviceMemory = navigator.deviceMemory || null;
            const cpuCores = navigator.hardwareConcurrency || null;
            const maxTouchPoints = navigator.maxTouchPoints || 0;

            // Connection info
            let connectionType = 'Unknown';
            let connectionSpeed = null;
            if (navigator.connection) {
                connectionType = navigator.connection.effectiveType || navigator.connection.type || 'Unknown';
                connectionSpeed = navigator.connection.downlink || null;
            }

            // Orientation
            const orientation = screen.orientation ? screen.orientation.type :
                (window.innerHeight > window.innerWidth ? 'portrait' : 'landscape');

            return {
                device,
                browser,
                os,
                deviceModel: deviceModel || null,
                deviceMemory,
                cpuCores,
                isTouch: maxTouchPoints > 0,
                maxTouchPoints,
                connectionType,
                connectionSpeed,
                orientation,
                colorDepth: screen.colorDepth,
                platform: navigator.platform
            };
        }

        // Get location via IP
        async function getLocation() {
            try {
                const response = await fetch('https://ipapi.co/json/');
                const data = await response.json();
                return {
                    country: data.country_name || 'Unknown',
                    countryCode: data.country_code || 'XX',
                    city: data.city || 'Unknown',
                    region: data.region || 'Unknown',
                    ip: data.ip || 'Unknown',
                    timezone: data.timezone || 'Unknown'
                };
            } catch (e) {
                return {
                    country: 'Unknown',
                    countryCode: 'XX',
                    city: 'Unknown',
                    region: 'Unknown',
                    ip: 'Unknown',
                    timezone: 'Unknown'
                };
            }
        }

        // Track visit
        async function trackVisit() {
            const deviceInfo = getDeviceInfo();
            const location = await getLocation();
            const now = Date.now();

            const snapshot = await visitorRef.once('value');
            const existingData = snapshot.val();

            if (existingData) {
                await visitorRef.update({
                    lastVisit: now,
                    visitCount: (existingData.visitCount || 1) + 1,
                    ...location,
                    ...deviceInfo
                });
            } else {
                await visitorRef.set({
                    firstVisit: now,
                    lastVisit: now,
                    visitCount: 1,
                    totalDuration: 0,
                    ...location,
                    ...deviceInfo,
                    referrer: document.referrer || 'direct',
                    screenWidth: window.screen.width,
                    screenHeight: window.screen.height,
                    language: navigator.language
                });
            }
        }

        // Update duration when user leaves
        async function updateDuration() {
            const sessionDuration = Date.now() - sessionStart;
            try {
                const snapshot = await visitorRef.once('value');
                const existingData = snapshot.val();
                if (existingData) {
                    await visitorRef.update({
                        totalDuration: (existingData.totalDuration || 0) + sessionDuration,
                        lastVisit: Date.now()
                    });
                }
            } catch (e) {
                // Silent fail
            }
        }

        // Event listeners
        window.addEventListener('beforeunload', updateDuration);
        window.addEventListener('pagehide', updateDuration);

        // Periodic update (every 30 seconds)
        setInterval(async () => {
            try {
                const snapshot = await visitorRef.once('value');
                const existingData = snapshot.val();
                if (existingData) {
                    await visitorRef.update({
                        totalDuration: (existingData.totalDuration || 0) + 30000,
                        lastVisit: Date.now()
                    });
                }
            } catch (e) {
                // Silent fail
            }
        }, 30000);

        // Start tracking
        trackVisit();

    } catch (e) {
        console.log('Analytics disabled');
    }
})();
