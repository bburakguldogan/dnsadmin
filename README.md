# 🌐 DNSAdmin

DNSAdmin; hosting sunucularınızdaki (cPanel, Plesk, DirectAdmin) DNS kayıtlarını tek bir merkezden yönetmenizi ve kendi kurduğunuz DNS sunucularına (ns1, ns2) anlık olarak göndermenizi sağlayan bir sistemdir.

Sistem 3 temel parçadan oluşur:
1.  **Controller (Ana Panel Sunucusu):** Her şeyi yönettiğiniz web paneli.
2.  **Node (DNS Sunucuları - ns1, ns2):** Alan adlarının internette yayınlandığı isim sunucuları.
3.  **Hooks (Hosting Sunucuları):** cPanel, Plesk veya DirectAdmin yüklü olan ana sunucularınız.

---

## 🇹🇷 Mala Anlatır Gibi Adım Adım Kurulum Kılavuzu 🚀

Kuruluma sırasıyla aşağıdaki adımlardan başlayın. Lütfen adımları atlamayın.

### ADIM 1: Ana Yönetim Panelinin Kurulması (Controller)
Bu kurulumu, web paneli olarak kullanacağınız **tamamen boş, yeni açılmış** bir sunucuda (Debian/Ubuntu veya CentOS/AlmaLinux) yapmalısınız.

1.  Sunucunuza SSH (terminal) ile `root` olarak bağlanın.
2.  Şu komutu kopyalayıp yapıştırın ve enter'a basın (bu komut kurulum dosyasını sunucuya indirir):
    ```bash
    wget -O install.sh "https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install.sh?v=2"
    ```
3.  Dosyaya çalıştırma izni verin:
    ```bash
    chmod +x install.sh
    ```
4.  Kurulumu başlatın (Port 80 üzerinden web paneli açılacaktır):
    ```bash
    ./install.sh --role controller --port 80 --notify-port 53
    ```
5.  **Şifrenizi Öğrenin:** Kurulum bittiğinde ekrana yeşil renkli kurulum başarı mesajı gelecektir. Sistem tarafından otomatik olarak rastgele üretilen geçici şifrenizi görmek için şu komutu yazın:
    ```bash
    cat /opt/dnsadmin-controller/admin_credentials.txt
    ```
6.  Tarayıcınızı açın, sunucunuzun IP adresini yazıp girin (Örn: `http://sunucu-ip-adresiniz`).
7.  Kullanıcı adına `admin` yazın, şifreye ise az önce `cat` komutuyla okuduğunuz şifreyi yapıştırıp giriş yapın.
8.  Giriş yaptığınızda karşınıza şifre değiştirme ekranı gelecektir. E-posta adresinizi girip, **kendinize ait yeni güvenli bir şifre belirleyin** ve kaydedin. Sistem sizi dışarı atacaktır. Yeni şifrenizle tekrar giriş yapın. Artık yönetim paneline ulaştınız!

---

### ADIM 2: DNS Sunucularının Bağlanması (ns1 / ns2 Node Agent)
Bu kurulumu, **ns1.alanadiniz.com** ve **ns2.alanadiniz.com** olarak kullanacağınız diğer DNS sunucularında yapacaksınız.

1.  ADIM 1'de kurduğunuz yönetim paneline tarayıcıdan girin.
2.  Sol menüden **"DNS Nodes"** sekmesine gelin. Sağ üstteki **"Add Node"** butonuna basın.
3.  Açılan ekrana DNS sunucunuzun adını (Örn: `ns1.alanadiniz.com`), IP adresini yazın. "Agent API URL" kısmına ise `http://<dns-sunucu-ip-adresi>:5300` yazarak kaydedin.
4.  Ekranın üstünde size mavi renkle bir **"Node Token"** (Anahtar) gösterecektir. O anahtarı kopyalayın.
5.  Şimdi **ns1 (DNS)** sunucunuza SSH (terminal) ile bağlanın ve şu komutları sırasıyla çalıştırın:
    ```bash
    # 1. Ajan kurulum scriptini indirin
    wget -O install-node.sh "https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-node.sh?v=2"
    
    # 2. Çalıştırma yetkisi verin
    chmod +x install-node.sh
    
    # 3. Kendi bilgilerinizi yazarak komutu çalıştırın (kopyaladığınız Token'ı buraya yapıştırın):
    ./install-node.sh --controller-url http://<kontrol-paneli-ip-adresiniz>:80 --token <panelden-aldiginiz-node-token> --ns-name ns1.alanadiniz.com
    ```
6.  Kurulum bittiğinde paneldeki "DNS Nodes" sayfasına dönün. ns1 sunucunuzun durumunun **"online"** (yeşil) olduğunu göreceksiniz. İkinci DNS sunucunuz (ns2) için de bu adımları tekrarlayın.

---

### ADIM 3: Web Hosting Sunucularının Bağlanması (cPanel / Plesk / DirectAdmin)
Bu adımı, sitelerinizin barındığı cPanel, Plesk veya DirectAdmin yüklü olan ana hosting sunucularınızda yapacaksınız. Buradaki amaç; hosting sunucusunda açılan, silinen veya güncellenen alan adlarının anında panel üzerinden ns1/ns2 sunucularına gitmesini sağlamaktır.

1.  Yönetim panelinize tarayıcıdan girin. Sol menüden **"Hosting Servers"** sekmesine gelin. Sağ üstteki **"Add Server"** butonuna basarak sunucunuzu ekleyin.
2.  Ekranın üstünde size bir **"Agent API Key"** verecektir. Onu kopyalayın.
3.  Kullandığınız panele göre hosting sunucunuzun SSH (terminal) ekranında aşağıdaki ilgili komutu çalıştırın:

#### A. cPanel / WHM Sunucunuz Varsa:
Sunucunuzda şu komutları sırasıyla çalıştırın:
```bash
wget -O install-cpanel.sh "https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-cpanel.sh?v=2"
chmod +x install-cpanel.sh
./install-cpanel.sh --controller-url http://<kontrol-paneli-ip-adresiniz>:80 --token <panelden-aldiginiz-server-api-key>
```

#### B. Plesk Sunucunuz Varsa:
Sunucunuzda şu komutları sırasıyla çalıştırın:
```bash
wget -O install-plesk.sh "https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-plesk.sh?v=2"
chmod +x install-plesk.sh
./install-plesk.sh --controller-url http://<kontrol-paneli-ip-adresiniz>:80 --token <panelden-aldiginiz-server-api-key>
```

#### C. DirectAdmin Sunucunuz Varsa:
Sunucunuzda şu komutları sırasıyla çalıştırın:
```bash
wget -O install-directadmin.sh "https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-directadmin.sh?v=2"
chmod +x install-directadmin.sh
./install-directadmin.sh --controller-url http://<kontrol-paneli-ip-adresiniz>:80 --token <panelden-aldiginiz-server-api-key>
```

Kurulum bu kadar! Artık hosting sunucunuzda yapılan her DNS değişikliği otomatik olarak ns1 ve ns2 sunucularınıza saniyeler içinde yansıyacaktır.

---

## 🇺🇸 English Installation Guide

### 1. Central Controller Setup (Master Server)
Run the following commands on a clean Debian/Ubuntu or RHEL/CentOS/AlmaLinux server to install the central dashboard:

```bash
wget -O install.sh "https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install.sh?v=2"
chmod +x install.sh
./install.sh --role controller --port 80 --notify-port 53
```

*   **First Login Credentials:** During setup, a random 16-character administrator password is generated and saved in `/opt/dnsadmin-controller/admin_credentials.txt`.
*   **Forced Security Reset:** Upon logging in for the first time, you will be forced to specify a secure email address and update your password before gaining access to the dashboard.

---

### 2. DNS Nameserver Node Agent Setup (ns1/ns2)
Add the node in your dashboard first under the **"DNS Nodes"** tab to receive a **Node Token**. Then run this installer on your dedicated nameservers:

```bash
wget -O install-node.sh "https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-node.sh?v=2"
chmod +x install-node.sh
./install-node.sh --controller-url http://<your-controller-ip>:80 --token <node-token-from-panel> --ns-name ns1.yourdomain.com
```

---

### 3. Hosting Server Integrations
Add the hosting server under the **"Hosting Servers"** tab to receive a **Server API Key**. Then run the integration hooks script on your hosting server:

#### A. cPanel / WHM Integration
```bash
wget -O install-cpanel.sh "https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-cpanel.sh?v=2"
chmod +x install-cpanel.sh
./install-cpanel.sh --controller-url http://<your-controller-ip>:80 --token <server-api-key-from-panel>
```

#### B. Plesk Integration
```bash
wget -O install-plesk.sh "https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-plesk.sh?v=2"
chmod +x install-plesk.sh
./install-plesk.sh --controller-url http://<your-controller-ip>:80 --token <server-api-key-from-panel>
```

#### C. DirectAdmin Integration
```bash
wget -O install-directadmin.sh "https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-directadmin.sh?v=2"
chmod +x install-directadmin.sh
./install-directadmin.sh --controller-url http://<your-controller-ip>:80 --token <server-api-key-from-panel>
```
