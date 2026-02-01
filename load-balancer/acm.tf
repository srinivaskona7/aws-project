# ACM Certificate - Imported from Local Files
resource "aws_acm_certificate" "cert" {
  private_key       = file("${path.module}/certs/${var.cert_folder}/tls.key")
  certificate_body  = file("${path.module}/certs/${var.cert_folder}/body.pem")
  certificate_chain = file("${path.module}/certs/${var.cert_folder}/chain.pem")

  tags = {
    Name = "${var.project_name}-acm-cert"
  }
}
