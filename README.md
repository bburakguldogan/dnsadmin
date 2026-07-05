# 🌐 DNSAdmin

DNSAdmin is a secure, light-weight, centralized DNS management panel designed for web hosting providers and infrastructure administrators. It enables synchronization of DNS zones from multiple web hosting servers (cPanel, Plesk, DirectAdmin) to multiple dedicated BIND 9 nameserver nodes in real time.

---

## 🇹🇷 Türkçe Kurulum Kılavuzu (Turkish Installation Guide)

Bu proje, hosting sunucularınızdaki (cPanel, Plesk, DirectAdmin) DNS kayıtlarını merkezi bir panel üzerinden kendi bağımsız BIND 9 DNS sunucularınıza (ns1, ns2) anlık olarak senkronize eder.

### 1. Ana Yönetim Paneli Kurulumu (Master Controller)
Yönetim panelini kurmak istediğiniz temiz bir **Debian/Ubuntu** veya **RHEL/CentOS/AlmaLinux** sunucusunda aşağıdaki komutu çalıştırmanız yeterlidir. Komut otomatik olarak Node.js, MariaDB (MySQL) kuracak, güvenli şifrelerinizi üretecek ve servisi aktif edecektir:

```bash
curl -sS https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install.sh | bash -s -- --role controller --port 5380 --notify-port 53
```

*   **İlk Giriş Şifresi:** Kurulum tamamlandığında, sistem otomatik olarak rastgele 16 karakterli bir şifre üretir ve bunu `/opt/dnsadmin-controller/admin_credentials.txt` dosyasına kaydeder.
*   **Zorunlu Şifre Değişimi:** Arayüze ilk giriş yaptığınızda güvenlik gereği e-posta adresinizi girmek ve şifrenizi güncellemek zorundasınız. Bu işlemi yapmadan panele erişemezsiniz.

---

### 2. DNS Sunucu Düğümleri Kurulumu (ns1 / ns2 Node Agent)
DNS sunucusu (ad sunucusu) olarak kullanacağınız makinede aşağıdaki komutu çalıştırarak BIND 9 kurulumunu ve otomatik ajan servisini yapılandırın:

```bash
curl -sS https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-node.sh | bash -s -- \
  --controller-url http://<kontrol-paneli-ip-adresiniz>:5380 \
  --token <panelden-aldiginiz-node-token> \
  --ns-name ns1.alanadiniz.com
```

*   Ajan kurulduktan sonra 60 saniyede bir CPU/RAM durumunu ve sağlık durumunu ana panele raporlar.

---

### 3. Web Hosting Sunucu Entegrasyonları (Kancalar)
Müşterilerinizin sitelerinde yaptığı DNS değişikliklerinin (ekleme, düzenleme, silme) anlık olarak gitmesi için hosting sunucularınıza uygun kancayı kurun:

#### A. cPanel / WHM Sunucuları için:
```bash
curl -sS https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-cpanel.sh | bash -s -- \
  --controller-url http://<kontrol-paneli-ip-adresiniz>:5380 \
  --token <panelden-aldiginiz-server-api-key>
```

#### B. Plesk Sunucuları için:
```bash
curl -sS https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-plesk.sh | bash -s -- \
  --controller-url http://<kontrol-paneli-ip-adresiniz>:5380 \
  --token <panelden-aldiginiz-server-api-key>
```

#### C. DirectAdmin Sunucuları için:
```bash
curl -sS https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-directadmin.sh | bash -s -- \
  --controller-url http://<kontrol-paneli-ip-adresiniz>:5380 \
  --token <panelden-aldiginiz-server-api-key>
```

---

## 🇺🇸 English Installation Guide

### 1. Central Controller Setup (Master Server)
Run the following command on a clean Debian/Ubuntu or RHEL/CentOS/AlmaLinux server to install Node.js, MariaDB (MySQL), configure the database, generate random passwords, and start the controller panel:

```bash
curl -sS https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install.sh | bash -s -- --role controller --port 5380 --notify-port 53
```

*   **First Login Credentials:** During setup, a random 16-character administrator password is generated and saved in `/opt/dnsadmin-controller/admin_credentials.txt`.
*   **Forced Security Reset:** Upon logging in for the first time, you will be forced to specify a secure email address and update your password before gaining access to the dashboard.

---

### 2. DNS Nameserver Node Agent Setup (ns1/ns2)
Run this installer on your dedicated nameservers. It installs BIND 9, configures directory paths, registers the agent node service, and triggers a 60-second status reporting heartbeat:

```bash
curl -sS https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-node.sh | bash -s -- \
  --controller-url http://<your-controller-ip>:5380 \
  --token <node-token-from-panel> \
  --ns-name ns1.yourdomain.com
```

---

### 3. Hosting Server Integrations

To automate real-time updates when zones are added, modified, or removed on your hosting platforms:

#### A. cPanel / WHM Integration
```bash
curl -sS https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-cpanel.sh | bash -s -- \
  --controller-url http://<your-controller-ip>:5380 \
  --token <server-api-key-from-panel>
```

#### B. Plesk Integration
```bash
curl -sS https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-plesk.sh | bash -s -- \
  --controller-url http://<your-controller-ip>:5380 \
  --token <server-api-key-from-panel>
```

#### C. DirectAdmin Integration
```bash
curl -sS https://raw.githubusercontent.com/bburakguldogan/dnsadmin/main/install-directadmin.sh | bash -s -- \
  --controller-url http://<your-controller-ip>:5380 \
  --token <server-api-key-from-panel>
```

---

## 🔒 Configuration & Variables

The controller and agent daemons read configuration overrides from standard Environment variables:

### Controller Variables
*   `PORT`: Port for the admin web panel (default: `5380`)
*   `NOTIFY_PORT`: UDP port to listen for DNS NOTIFY messages (default: `5353`)
*   `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`: Credentials for database access.
*   `JWT_SECRET`: Signature key for encoding API authorization tokens.

### Node Agent Variables
*   `PORT`: Agent daemon API listener port (default: `5300`)
*   `DNSADMIN_TOKEN`: Authentication token verifying requests sent by the Controller.
*   `DNSADMIN_CONTROLLER_URL`: URL pointing to the central controller.
*   `NODE_NAME`: Node hostname reported to the controller (default: system hostname).
*   `RELOAD_CMD`: Shell command triggered to reload BIND 9 configurations.

---

## 📄 License
Private repository properties. Created and maintained by `@bburakguldogan`.
