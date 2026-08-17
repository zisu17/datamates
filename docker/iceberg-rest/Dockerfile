# Iceberg REST 카탈로그 — Postgres 백엔드용.
#
# 기본 이미지(apache/iceberg-rest-fixture)는 **SQLite JDBC 드라이버만** 번들한다.
# 팻 jar 안 META-INF/services/java.sql.Driver 에 org.sqlite.JDBC 하나뿐이라,
# CATALOG_URI 를 jdbc:postgresql:// 로 바꾸기만 하면 드라이버를 못 찾아 기동에 실패한다.
# (증상: "No suitable driver found for jdbc:postgresql://..." — 설정 오타처럼 보인다)
#
# 그래서 드라이버 jar 를 더해 클래스패스로 띄운다. `java -jar` 는 -cp 를 **무시하므로**
# 메인 클래스를 직접 지정해야 한다 — 팻 jar 의 Main-Class 와 같은 값이다.
FROM apache/iceberg-rest-fixture:1.10.1

# ADD 는 URL 을 도커가 직접 받는다(이미지에 curl/wget 이 없어도 된다).
# 다만 받은 파일은 root 소유 0600 이라 그대로 두면 기동 사용자(iceberg, uid 1000)가
# 읽지 못한다 — 클래스패스에 있어도 없는 것처럼 동작한다.
USER root
ADD https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.4/postgresql-42.7.4.jar \
    /usr/lib/iceberg-rest/postgresql.jar
RUN chmod 0644 /usr/lib/iceberg-rest/postgresql.jar
USER iceberg:iceberg

CMD ["java", "-cp", \
     "/usr/lib/iceberg-rest/iceberg-rest-adapter.jar:/usr/lib/iceberg-rest/postgresql.jar", \
     "org.apache.iceberg.rest.RESTCatalogServer"]
