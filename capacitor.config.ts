import type {CapacitorConfig} from '@capacitor/cli';
const config:CapacitorConfig={appId:'com.wenjian.reader',appName:'问间',webDir:'mobile/dist',android:{allowMixedContent:false,minWebViewVersion:111},server:{errorPath:'unsupported-webview.html'},plugins:{CapacitorHttp:{enabled:false},SplashScreen:{launchShowDuration:0}}};
export default config;
