from dotenv import load_dotenv
load_dotenv()  # MUST be first import

import re
import json
from datetime import datetime
from cryptography.fernet import Fernet
import os
import sys
from typing import Dict, List, Set, Tuple, Any

# Type alias for clarity
SensitiveMatches = Dict[str, List[str]]

# =================================================================
# 1. Content Detection Module - Using Google Vertex AI
# =================================================================

# Import Google Vertex AI components
try:
    from google.cloud import aiplatform
    from google.cloud.aiplatform.gapic.schema import predict
    from langchain.prompts import PromptTemplate
    print("Successfully imported Google Vertex AI components")
except ImportError:
    print("ERROR: Required libraries not found. Install with: pip install google-cloud-aiplatform langchain")
    
    # Define a simple fallback PromptTemplate class if needed
    class PromptTemplate:
        def __init__(self, template, input_variables):
            self.template = template
            self.input_variables = input_variables
            
        def format(self, **kwargs):
            result = self.template
            for var in self.input_variables:
                if var in kwargs:
                    result = result.replace(f"{{{var}}}", str(kwargs[var]))
            return result

# Global variable to store Vertex AI client instance
vertex_ai_client = None
project_id = None
location = None
model_name = None

# Enhanced content detection template that covers both hate speech/profanity and sensitive info
content_detection_template = """
Analyze the following text and identify all problematic content including hate speech, profanity, and sensitive information in any language.
Return ONLY a valid JSON with these keys:
- "hate_speech": true/false if hate speech is detected
- "profanity": true/false if profanity is detected
- "flagged_words": array of specific problematic words detected
- "flagged_sentences": array of complete sentences containing hate speech or profanity
- "sensitive_info": object containing detected sensitive information with these keys:
  - "phone_numbers": array of detected phone numbers
  - "emails": array of detected email addresses
  - "aadhaar": array of detected Aadhaar numbers (12-digit Indian ID)
  - "pan": array of detected PAN numbers (Indian tax ID)
  - "account_numbers": array of detected bank account numbers
  - "ifsc_codes": array of detected IFSC codes
  - "swift_codes": array of detected SWIFT codes
  - "passport_numbers": array of detected passport numbers
  - "credit_cards": array of detected credit card numbers
  - "gps_coordinates": array of detected GPS coordinates
  - "ssn": array of detected Social Security Numbers
  - "nhs_numbers": array of detected NHS numbers
  - "other_sensitive": array of other potentially sensitive information

TEXT: {text}

Respond with ONLY the JSON object. No other text, no explanations.
"""

detection_prompt = PromptTemplate(
    template=content_detection_template,
    input_variables=["text"]
)

# Define patterns for hate speech and profanity detection
HATE_SPEECH_KEYWORDS = [
    # Violence and elimination keywords
    r'\b(?:kill|eliminate|destroy|murder|slaughter|genocide)\s+(?:all|every|each)\s+(?:\w+\s+)*(?:people|group|community|race|ethnicity)\b',
    r'\b(?:death|die|eliminate|exterminate)\s+to\s+(?:all|every)\s+(?:\w+\s+)*(?:people|group|community|race|ethnicity)\b',
    
    # Dehumanization patterns
    r'\b(?:all|every|those)\s+(?:\w+\s+)*(?:people|group|community|race|ethnicity)\s+(?:are|is)\s+(?:animals|vermin|cockroaches|rats|trash|garbage)\b',
    
    # Violent action patterns
    r'\b(?:we|they|people|everyone)\s+should\s+(?:kill|eliminate|eradicate|remove|cleanse)\s+(?:all|every|the|those)\s+(?:\w+\s+)*(?:people|group|community|race|ethnicity)\b',
    
    # General hate patterns
    r'\b(?:hate|despise|loathe)\s+(?:all|every|those|these)\s+(?:\w+\s+)*(?:people|group|community|race|ethnicity)\b',
    
    # Explicit discriminatory statements
    r'\b(?:all|every|each)\s+(?:\w+\s+)*(?:people|group|community|race|ethnicity)\s+(?:should|must|need to)\s+(?:be|get)\s+(?:banned|deported|removed|eliminated|killed)\b',
]

# Common profanity and slurs (abbreviated/masked to avoid explicit content)
PROFANITY_PATTERNS = [
    # Common general profanity (abbreviated)
    r'\ba[s$][s$]\b', r'\bb[i!]t?ch\b', r'\bf[u\*][c\*]k\b', r'\bs[h\*][i\*]t\b', 
    r'\bd[a\*]mn\b', r'\bh[e\*]ll\b', r'\bcr[a\*]p\b', r'\bd[i\*]ck\b',
    
    # Hindi/Urdu profanity
    r'\bg[a\*][a\*]nd\b', r'\bch[u\*]t[i\*]ya\b', r'\bb[e\*][h\*][e\*]n ?ch[o\*]d\b',
    
    # Various slurs (intentionally abbreviated)
    r'\bn[i\*]gg[e\*]r\b', r'\bf[a\*]g\b', r'\bc[u\*]nt\b',
    
    # Common substitutions
    r'\bf\*\*k\b', r'\bs\*\*t\b', r'\ba\*\*\b', r'\bb\*\*\*h\b',
]

def setup_vertex_ai(project=None, loc=None, model=None):
    """Setup Google Vertex AI connection"""
    global vertex_ai_client, project_id, location, model_name
    
    # Check for existing working client instance
    if vertex_ai_client is not None:
        print("Using existing Vertex AI client instance")
        return vertex_ai_client
    
    # Get configuration from environment variables if not provided
    if not project:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not loc:
        loc = os.environ.get("VERTEX_AI_LOCATION", "us-central1")
    if not model:
        model = os.environ.get("VERTEX_AI_MODEL", "text-bison@002")
        
    # Consider using a more modern model if available
    if model == "text-bison@002":
        # Suggest alternative models if text-bison is specified
        print("Note: Consider using a newer model like 'gemini-1.5-flash-001'")
    
    # Check if project ID is available
    if not project:
        print("ERROR: No Google Cloud project ID provided.")
        print("Set your project ID using the GOOGLE_CLOUD_PROJECT environment variable")
        print("or pass it as a parameter to setup_vertex_ai()")
        return None
        
    try:
        # Import the aiplatform module
        from google.cloud import aiplatform
        
        # Initialize Vertex AI client
        aiplatform.init(project=project, location=loc)
        
        # Store the configuration for later use
        vertex_ai_client = True
        project_id = project
        location = loc
        model_name = model
        
        print(f"Google Vertex AI initialized with project: {project}, location: {loc}, model: {model}")
        
        # Test the connection by creating a model object
        try:
            endpoint = f"projects/{project_id}/locations/{location}/publishers/google/models/{model_name}"
            test_model = aiplatform.Model(endpoint)
            # If we got here, the model is accessible
            print(f"Vertex AI model {model_name} connected successfully")
            return vertex_ai_client
        except Exception as e:
            print(f"Vertex AI test failed: {str(e)}")
            return None
            
    except Exception as e:
        print(f"Error initializing Vertex AI: {str(e)}")
        return None


# Function to detect hate speech and profanity
def detect_hate_speech_profanity(text):
    """Detect hate speech and profanity using regex patterns"""
    results = {
        "hate_speech": False,
        "profanity": False,
        "flagged_words": [],
        "flagged_sentences": []
    }
    
    # Improved sentence splitting - handle multiple punctuation and line breaks
    # This regex splits on sentence-ending punctuation followed by whitespace or end of string
    sentences = []
    # First split by newlines to preserve paragraph structure
    paragraphs = text.split('\n')
    for paragraph in paragraphs:
        # Then split each paragraph into sentences
        paragraph_sentences = re.split(r'(?<=[.!?])\s+|(?<=[.!?])$', paragraph)
        # Filter out empty strings
        paragraph_sentences = [s.strip() for s in paragraph_sentences if s.strip()]
        sentences.extend(paragraph_sentences)
    
    # Check each sentence for hate speech patterns
    for sentence in sentences:
        has_hate_speech = False
        has_profanity = False
        profanity_words = []
        
        # Check for hate speech
        for pattern in HATE_SPEECH_KEYWORDS:
            if re.search(pattern, sentence.lower()):
                has_hate_speech = True
                results["hate_speech"] = True
                break
        
        # Check for profanity
        for pattern in PROFANITY_PATTERNS:
            matches = re.finditer(pattern, sentence.lower())
            for match in matches:
                has_profanity = True
                results["profanity"] = True
                flagged_word = match.group(0)
                if flagged_word not in results["flagged_words"]:
                    results["flagged_words"].append(flagged_word)
                profanity_words.append(flagged_word)
        
        # Add sentence to flagged sentences if it contains hate speech or profanity
        if has_hate_speech or has_profanity:
            if sentence not in results["flagged_sentences"]:
                results["flagged_sentences"].append(sentence)
    
    return results

PATTERNS = {
    # Indian phone numbers - start with 6, 7, 8, or 9 followed by 9 digits
    "phone_numbers": [
        r'\b(?:\+91[\s-]?)?[6-9]\d{9}\b',  # Indian format with or without +91
        r'\b(?:0)?[6-9]\d{9}\b',           # With optional 0 prefix
        r'\b[6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4}\b',  # With separators
    ],
    
    # Email addresses
    "emails": [
        r'\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b'
    ],
    
    # Aadhaar numbers (12 digits, often with spaces after every 4 digits)
    "aadhaar": [
        r'\b\d{4}\s?\d{4}\s?\d{4}\b'
    ],
    
    # PAN (Permanent Account Number) - 5 uppercase letters followed by 4 digits and 1 uppercase letter
    "pan": [
        r'\b[A-Z]{5}[0-9]{4}[A-Z]\b'
    ],
    
    # Bank account numbers (generally 9-18 digits)
    "account_numbers": [
        r'\b(?:acc(?:ount)?(?:\s?(?:no|number|#))?\s?[:=]?\s?)?\d{9,18}\b',  # With potential prefix
        r'\ba/c\s?(?:no|#|:|=)?\s?\d{9,18}\b',  # a/c format
        r'\bank\s?(?:no|#|:|=)?\s?\d{9,18}\b'   # bank no format
    ],
    
    # IFSC codes for Indian banks (4 chars + 0 + 6 chars/digits)
    "ifsc_codes": [
        r'\b[A-Z]{4}0[A-Z0-9]{6}\b'
    ],
    
    # SWIFT codes for international banks (8 or 11 characters)
    "swift_codes": [
        r'\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b'
    ],
    
    # Credit card numbers (with or without separators)
    "credit_cards": [
        r'\b(?:\d{4}[\s-]?){3}\d{4}\b',  # Common format with separators
        r'\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b'  # Various card formats without separators
    ],
    
    # US Social Security Numbers
    "ssn": [
        r'\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b'
    ],
    
    # NHS numbers (UK National Health Service) - 10 digits with specific validation
    "nhs_numbers": [
        r'\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b'
    ],
    
    # Passport numbers (various formats)
    "passport_numbers": [
        r'\b[A-Z]{1,2}\d{6,9}\b',  # Common format for many countries
        r'\b[A-Z][0-9]{7}\b'       # US format
    ],
    
    # GPS coordinates
    "gps_coordinates": [
        r'\b-?\d{1,2}\.\d{1,8},\s*-?\d{1,3}\.\d{1,8}\b'  # Decimal format
    ]
}

# Context keywords that increase likelihood of correct identification
CONTEXT_KEYWORDS = {
    "phone_numbers": ['phone', 'mobile', 'cell', 'call', 'contact', 'tel', 'telephone'],
    "emails": ['email', 'mail', 'contact', 'address', '@'],
    "aadhaar": ['aadhaar', 'aadhar', 'uid', 'unique id', 'identity', 'identification'],
    "pan": ['pan', 'permanent account', 'tax', 'income tax', 'it department'],
    "account_numbers": ['account', 'bank', 'a/c', 'acc', 'savings', 'current', 'deposit'],
    "ifsc_codes": ['ifsc', 'bank', 'branch', 'rtgs', 'neft', 'transfer'],
    "swift_codes": ['swift', 'bic', 'bank', 'international', 'transfer', 'foreign'],
    "credit_cards": ['credit', 'card', 'debit', 'visa', 'mastercard', 'amex', 'payment'],
    "ssn": ['social security', 'ssn', 'social insurance', 'national id'],
    "nhs_numbers": ['nhs', 'national health', 'health service', 'medical', 'patient'],
    "passport_numbers": ['passport', 'travel', 'document', 'visa', 'international'],
    "gps_coordinates": ['gps', 'location', 'coordinates', 'latitude', 'longitude', 'position', 'map']
}

# ======================================================
# VALIDATION FUNCTIONS
# ======================================================

def is_valid_indian_phone(match: str) -> bool:
    """Validate if a string is a valid Indian phone number."""
    # Remove any non-digit characters
    digits = re.sub(r'\D', '', match)
    
    # Check if starts with country code
    if digits.startswith('91'):
        digits = digits[2:]
    elif digits.startswith('0'):
        digits = digits[1:]
        
    # Must be 10 digits and start with 6-9
    return (len(digits) == 10 and 
            digits[0] in ('6', '7', '8', '9'))

def is_valid_email(match: str) -> bool:
    """Validate if a string is a valid email address."""
    # Basic email validation
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(pattern, match):
        return False
    
    # Check domain has at least one dot
    parts = match.split('@')
    if len(parts) != 2 or '.' not in parts[1]:
        return False
        
    return True

def is_valid_aadhaar(match: str) -> bool:
    """Validate if a string is a valid Aadhaar number."""
    digits = re.sub(r'\D', '', match)
    
    # Must be exactly 12 digits
    if len(digits) != 12:
        return False
    
    # Verhoeff algorithm can be implemented for full validation
    # This is a simplified version
    return True

def is_valid_pan(match: str) -> bool:
    """Validate if a string is a valid PAN number."""
    # Must be 10 characters: 5 letters + 4 digits + 1 letter
    if not re.match(r'^[A-Z]{5}[0-9]{4}[A-Z]$', match):
        return False
    
    # First character represents category (P for individual, C for company, etc.)
    valid_first_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if match[0] not in valid_first_chars:
        return False
    
    # Fourth character represents status (P for individual, C for company, etc.)
    valid_fourth_chars = "ABCFGHLJPTK"
    if match[3] not in valid_fourth_chars:
        return False
    
    return True

def is_valid_account_number(match: str, context: str) -> bool:
    """Validate if a string is a valid bank account number."""
    # Extract only the digits from the match
    digits = re.sub(r'\D', '', match)
    
    # Most bank account numbers are between 9 and 18 digits
    if len(digits) < 9 or len(digits) > 18:
        return False
    
    # Check surrounding context for keywords that suggest this is a bank account
    account_context = any(keyword in context.lower() for keyword in 
                         ['account', 'bank', 'a/c', 'acc', 'savings', 'current'])
    
    return account_context

def is_valid_ifsc(match: str) -> bool:
    """Validate if a string is a valid IFSC code."""
    # IFSC format: First 4 characters are bank code (letters), 
    # 5th is 0, and last 6 can be alphanumeric
    if not re.match(r'^[A-Z]{4}0[A-Z0-9]{6}$', match):
        return False
    
    # Could add a check against a list of valid bank codes
    return True

def is_valid_swift(match: str) -> bool:
    """Validate if a string is a valid SWIFT/BIC code."""
    # SWIFT codes are either 8 or 11 characters
    if not (len(match) == 8 or len(match) == 11):
        return False
    
    # First 4 are bank code (letters)
    # Next 2 are country code (letters)
    # Next 2 are location code (letters or digits)
    # Last 3 (optional) are branch code (letters or digits)
    if not re.match(r'^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$', match):
        return False
    
    return True

def is_valid_credit_card(match: str) -> bool:
    """
    Validate if a string is a valid credit card number using Luhn algorithm.
    """
    # Remove any non-digit characters
    digits = re.sub(r'\D', '', match)
    
    # Check if length is valid (13-19 digits for most cards)
    if not (13 <= len(digits) <= 19):
        return False
    
    # Make sure it's not an Aadhaar number (to prevent false positives)
    if len(digits) == 12:
        return False
    
    # Check card type based on prefix
    valid_prefix = False
    if digits.startswith('4'):  # Visa
        valid_prefix = True
    elif digits.startswith(('51', '52', '53', '54', '55')):  # Mastercard
        valid_prefix = True
    elif digits.startswith(('34', '37')):  # American Express
        valid_prefix = True
    elif digits.startswith(('6011', '644', '65')):  # Discover
        valid_prefix = True
    elif digits.startswith(('5018', '5020', '5038', '5893', '6304', '6759', '6761', '6762', '6763')):  # Maestro
        valid_prefix = True
    elif digits.startswith(('3528', '3529', '353', '354', '355', '356', '357', '358')):  # JCB
        valid_prefix = True
    elif digits.startswith(('36', '300', '301', '302', '303', '304', '305')):  # Diners Club
        valid_prefix = True
    
    # Apply Luhn algorithm (checksum validation)
    checksum = 0
    for i, digit in enumerate(reversed(digits)):
        n = int(digit)
        if i % 2 == 1:  # odd position (from right)
            n *= 2
            if n > 9:
                n -= 9
        checksum += n
    
    return (checksum % 10 == 0) and valid_prefix

def is_valid_ssn(match: str) -> bool:
    """Validate if a string is a valid US Social Security Number."""
    # Remove any non-digit characters
    digits = re.sub(r'\D', '', match)
    
    # Must be exactly 9 digits
    if len(digits) != 9:
        return False
    
    # Cannot begin with 000, 666, or 900-999
    if (digits.startswith('000') or 
        digits.startswith('666') or 
        (digits.startswith('9') and int(digits[:3]) >= 900)):
        return False
    
    # Middle group cannot be 00
    if digits[3:5] == '00':
        return False
    
    # Last group cannot be 0000
    if digits[5:] == '0000':
        return False
    
    return True

def is_valid_nhs_number(match: str, text: str) -> bool:
    """
    Validate if a string is a valid NHS number based on the NHS checksum algorithm.
    Also checks it's not more likely to be an Indian phone number.
    """
    # Remove any non-digit characters
    digits = re.sub(r'\D', '', match)
    
    # NHS numbers are exactly 10 digits
    if len(digits) != 10:
        return False
    
    # Check if it matches the pattern of an Indian phone number
    # If it starts with 6, 7, 8, or 9, it's more likely a phone number
    if digits[0] in ('6', '7', '8', '9'):
        # Only consider it an NHS number if there's strong NHS context
        nhs_context = ('nhs' in text.lower() or 'national health' in text.lower())
        if not nhs_context:
            return False
    
    # NHS checksum validation:
    # Multiply each of the first 9 digits by a weight factor
    # 10,9,8,7,6,5,4,3,2 respectively
    # Sum them, divide by 11, and calculate remainder
    # Subtract remainder from 11 to get check digit (if 11, check digit is 0)
    # The resulting check digit should match the 10th digit of the NHS number
    
    weights = [10, 9, 8, 7, 6, 5, 4, 3, 2]
    checksum = sum(int(digits[i]) * weights[i] for i in range(9))
    remainder = checksum % 11
    check_digit = 11 - remainder

import re
import json

def regex_pattern_detection(text):
    """
    Detect sensitive information using improved regex patterns.
    Returns a dictionary with categorized matches of sensitive information.
    """
    patterns = {
        "phone_numbers": [
            # Indian mobile numbers (10 digits starting with 6, 7, 8, or 9)
            r'\b[6-9]\d{9}\b',
            
            # Indian mobile with country code formats
            r'\+91[6-9]\d{9}\b',
            r'0091[6-9]\d{9}\b',
            
            # Indian mobile with common separators
            r'\b[6-9]\d{4}[\s.-]?\d{5}\b',
            r'\+91[\s.-]?[6-9]\d{9}\b',
            
            # International format with country code (allowing for different country codes)
            r'\+\d{1,4}[\s.-]?\d{6,14}'
        ],
        "emails": [
            # Standard email format
            r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        ],
        "aadhaar": [
            # Standard 12-digit Aadhaar number format with optional spaces
            r'\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b',
            
            # Masked Aadhaar number format (X's for first 8 digits)
            r'\bXXXX[\s.-]?XXXX[\s.-]?\d{4}\b'
        ],
        "pan": [
            # PAN format: 5 uppercase letters + 4 digits + 1 uppercase letter
            r'\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b'
        ],
        "account_numbers": [
            # Common Indian bank account numbers (typically 11-18 digits)
            # Avoiding overlap with phone numbers by requiring more than 10 digits
            r'\b\d{11,18}\b'
        ],
        "ifsc_codes": [
            # IFSC format: 4 uppercase letters + 0 + 6 alphanumeric characters
            r'\b[A-Z]{4}0[A-Z0-9]{6}\b'
        ],
        "swift_codes": [
            # SWIFT/BIC code format: 8 or 11 alphanumeric characters
            r'\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b'
        ],
        "credit_cards": [
            # Major credit card formats with separators
            r'\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b',
            
            # Credit card numbers with separators
            r'\b(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|3(?:0[0-5]|[68][0-9])|6(?:011|5[0-9]{2}))[\s.-]?(?:[0-9]{4}[\s.-]?){2}[0-9]{4}\b'
        ],
        "passport_numbers": [
            # Indian passport format: 1 letter followed by 7 digits
            r'\b[A-Z][0-9]{7}\b'
        ],
        "ssn": [
            # US SSN format: XXX-XX-XXXX
            r'\b\d{3}-\d{2}-\d{4}\b',
            r'\b\d{3}\s\d{2}\s\d{4}\b'
        ],
        "gps_coordinates": [
            # GPS coordinate formats
            r'\b-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+\b'
        ],
        "nhs_numbers": [
            # UK NHS number format: XXX XXX XXXX with strict spacing and checksum validation
            r'\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b'
        ]
    }
    
    sensitive_info = {}
    already_matched = set()  # Track all matched strings to avoid duplicates
    
    # Process categories in a specific order to prioritize more specific patterns
    category_order = [
        "emails", "pan", "ifsc_codes", "swift_codes", "passport_numbers", 
        "credit_cards", "ssn", "gps_coordinates", "phone_numbers", "nhs_numbers", "aadhaar",
        "account_numbers"
    ]
    
    # First pass: process according to priority order
    for category in category_order:
        pattern_list = patterns[category]
        matches = []
        
        for pattern in pattern_list:
            # Find all matches for this pattern
            for match in re.finditer(pattern, text):
                matched_text = match.group(0)
                
                # Skip if already matched in a higher priority category
                if matched_text in already_matched:
                    continue
                
                # Additional validation for specific types
                if category == "phone_numbers":
                    # Extract the actual digits for validation
                    digits = re.sub(r'\D', '', matched_text)
                    # For Indian numbers, make sure it starts with 6-9 if it's 10 digits
                    if len(digits) == 10 and not digits[0] in "6789":
                        continue
                    # If it's not an Indian number with country code
                    if len(digits) > 10 and digits.startswith("91") and not digits[2] in "6789":
                        continue
                    
                    # Check if this could be an NHS number - if so, skip it here
                    if len(digits) == 10 and validate_nhs_number(matched_text):
                        continue
                
                elif category == "aadhaar" and not validate_aadhaar(matched_text):
                    continue
                
                elif category == "pan" and not validate_pan(matched_text):
                    continue
                
                elif category == "credit_cards" and not validate_credit_card(matched_text):
                    continue
                    
                elif category == "nhs_numbers" and not validate_nhs_number(matched_text):
                    continue
                    
                # Additional check to prevent phone numbers being identified as account numbers
                if category == "account_numbers":
                    digits = re.sub(r'\D', '', matched_text)
                    # Skip 10-digit numbers as they are likely phone numbers
                    if len(digits) == 10:
                        continue
                    # Skip 12-digit numbers that validate as Aadhaar
                    if len(digits) == 12 and validate_aadhaar(digits):
                        continue
                
                # Prevent credit card numbers from matching with Aadhaar numbers
                if category == "credit_cards":
                    digits = re.sub(r'\D', '', matched_text)
                    # Skip if it's a valid Aadhaar number
                    if len(digits) == 12 and validate_aadhaar(digits):
                        continue
                
                # Add to matches and mark as matched
                matches.append(matched_text)
                already_matched.add(matched_text)
        
        if matches:
            sensitive_info[category] = list(set(matches))  # Remove duplicates
        else:
            sensitive_info[category] = []
    
    # Initialize the structure for the results
    return {
        "hate_speech": False,  # Placeholder
        "profanity": False,    # Placeholder
        "flagged_words": [],   # Placeholder
        "flagged_sentences": [],
        "sensitive_info": sensitive_info
    }

def validate_aadhaar(text):
    """
    Basic validation for Aadhaar numbers.
    Ensures proper length after removing non-digits.
    """
    digits = re.sub(r'\D', '', text)
    # Check if it has exactly 12 digits
    if len(digits) != 12:
        return False
    
    # Additional checks could be added here for Aadhaar Verhoeff algorithm
    # But for simplicity, we'll just verify the length
    return True

def validate_nhs_number(text):
    """
    Validation for NHS numbers using the checksum algorithm.
    NHS numbers use a specific format and checksum validation.
    """
    # Remove any spaces or hyphens
    digits = re.sub(r'\D', '', text)
    
    # NHS numbers must be 10 digits
    if len(digits) != 10:
        return False
    
    # Apply NHS checksum algorithm
    # Multiply each of the first 9 digits by a weight factor
    weights = [10, 9, 8, 7, 6, 5, 4, 3, 2]
    checksum = sum(int(digits[i]) * weights[i] for i in range(9))
    
    # The checksum mod 11 should be 0 for a valid NHS number
    check_digit = 11 - (checksum % 11)
    if check_digit == 11:
        check_digit = 0
    
    # Compare calculated check digit with the actual last digit
    return check_digit == int(digits[9])

def validate_pan(text):
    """
    Basic validation for PAN card numbers.
    Format: AAAAA0000A where A is a letter and 0 is a digit.
    """
    if not re.match(r'^[A-Z]{5}[0-9]{4}[A-Z]$', text):
        return False
    return True

def validate_credit_card(text):
    """
    Basic Luhn algorithm check for credit card number validation.
    """
    # Remove non-digits
    digits = re.sub(r'\D', '', text)
    
    # Luhn algorithm check
    if len(digits) < 13 or len(digits) > 19:
        return False
        
    # Make sure it's not an Aadhaar number (12 digits)
    if len(digits) == 12 and validate_aadhaar(digits):
        return False
    
    # Apply Luhn algorithm
    check_sum = 0
    num_digits = len(digits)
    odd_even = num_digits & 1
    
    for i in range(num_digits):
        digit = int(digits[i])
        if ((i & 1) ^ odd_even) == 0:
            digit = digit * 2
            if digit > 9:
                digit = digit - 9
        check_sum = check_sum + digit
    
    return (check_sum % 10) == 0

def detect_with_vertex_ai(text):
    """Use Google Vertex AI for comprehensive detection with improved error handling"""
    global vertex_ai_client, project_id, location, model_name
    
    if vertex_ai_client is None:
        print("No Google Vertex AI client available")
        return None
        
    try:
        from google.cloud import aiplatform
        
        # Initialize the Vertex AI SDK
        aiplatform.init(project=project_id, location=location)
        
        # Format the prompt using the template
        formatted_prompt = detection_prompt.format(text=text)
        
        # Use PredictionService for text generation
        # This is the updated way to call Vertex AI models
        endpoint = f"projects/{project_id}/locations/{location}/publishers/google/models/{model_name}"
        
        # Create a model for prediction
        model = aiplatform.Model(endpoint)
        
        # Send to Vertex AI
        print("Sending text to Google Vertex AI for analysis...")
        
        # Make the prediction
        response = model.predict(
            instances=[{"content": formatted_prompt}],
            parameters={
                "temperature": 0.1,
                "maxOutputTokens": 1024,
                "topK": 40,
                "topP": 0.8,
            }
        )
        
        # Get the prediction result
        result = response.predictions[0]
        if isinstance(result, dict) and "content" in result:
            result = result["content"]
            
        # Debug output (limited to avoid overwhelming console)
        print(f"Raw Vertex AI response preview: {result[:100]}..." if len(result) > 100 else f"Raw Vertex AI response: {result}")
        
        # Extract JSON from the response (handle both clean and messy responses)
        try:
            # First attempt: try parsing the entire response as JSON
            parsed_json = json.loads(result)
            return parsed_json
        except json.JSONDecodeError:
            # Second attempt: extract JSON block from response
            json_match = re.search(r'(\{.*\})', result, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
                # Clean up JSON string (fix common issues)
                json_str = re.sub(r',\s*}', '}', json_str)  # Fix trailing commas
                json_str = re.sub(r',\s*]', ']', json_str)  # Fix trailing commas in arrays
                
                try:
                    parsed_json = json.loads(json_str)
                    return parsed_json
                except json.JSONDecodeError as e:
                    print(f"JSON parsing error: {e}")
                    print(f"Problematic JSON: {json_str[:200]}...")
                    return None
            else:
                print("No JSON found in Vertex AI response")
                return None
    except Exception as e:
        print(f"Google Vertex AI detection error: {str(e)}")
        return None



# For Gemini models, adjust the predict call like this:
def detect_with_vertex_ai_gemini(text):
    """Version specific for Gemini models"""
    global vertex_ai_client, project_id, location, model_name
    
    if vertex_ai_client is None:
        print("No Google Vertex AI client available")
        return None
        
    try:
        from vertexai import generative_models
        from vertexai.generative_models import GenerativeModel
        
        # Import and initialize the Vertex AI Python SDK
        import vertexai
        vertexai.init(project=project_id, location=location)
        
        # Format the prompt using the template
        formatted_prompt = detection_prompt.format(text=text)
        
        print("Sending text to Google Vertex AI Gemini for analysis...")
        
        # For Gemini models, use the GenerativeModel class
        model = GenerativeModel(model_name)
        
        # Generate content
        response = model.generate_content(formatted_prompt)
        
        # Extract the text from the response
        result = response.text
        
        # Debug output
        print(f"Raw Gemini response preview: {result[:100]}..." if len(result) > 100 else f"Raw Gemini response: {result}")
        
        # Process JSON response - same as before
        try:
            parsed_json = json.loads(result)
            return parsed_json
        except json.JSONDecodeError:
            json_match = re.search(r'(\{.*\})', result, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
                json_str = re.sub(r',\s*}', '}', json_str) 
                json_str = re.sub(r',\s*]', ']', json_str)
                
                try:
                    parsed_json = json.loads(json_str)
                    return parsed_json
                except json.JSONDecodeError as e:
                    print(f"JSON parsing error: {e}")
                    return None
            else:
                print("No JSON found in Gemini response")
                return None
    except Exception as e:
        print(f"Google Vertex AI Gemini detection error: {str(e)}")
        return None
        

        
def detect_content(text, project_id=None, location=None, model_name=None):
    """Combined detection using both Vertex AI and regex with fallbacks"""
    print("Analyzing content...")
    
    # Always use regex detection for sensitive information as baseline
    regex_results = regex_pattern_detection(text)
    
    # Set up or get Vertex AI instance
    setup_vertex_ai(project_id, location, model_name)
    
    # Check if it's a Gemini model
    vertex_ai_results = None
    if model_name and ('gemini' in model_name.lower()):
        # Use Gemini-specific code path
        vertex_ai_results = detect_with_vertex_ai_gemini(text)
    else:
        # Use standard Vertex AI approach
        vertex_ai_results = detect_with_vertex_ai(text)
        
    # If Vertex AI detection failed completely, use regex results
    if not vertex_ai_results:
        print("Using regex-based detection results (Vertex AI unavailable or failed)")
        return regex_results
    
    # If Vertex AI succeeded, merge with regex findings for better sensitive info detection
    print("Merging Vertex AI and regex detection results")
    
    # Ensure sensitive_info exists in Vertex AI results
    if "sensitive_info" not in vertex_ai_results:
        vertex_ai_results["sensitive_info"] = {}
    
    # Ensure all categories exist in Vertex AI results
    for category in regex_results["sensitive_info"]:
        if category not in vertex_ai_results["sensitive_info"]:
            vertex_ai_results["sensitive_info"][category] = []
    
    # Merge sensitive info findings from regex
    for category, items in regex_results["sensitive_info"].items():
        if items:
            # Add regex findings to Vertex AI results
            if not isinstance(vertex_ai_results["sensitive_info"][category], list):
                vertex_ai_results["sensitive_info"][category] = []
            vertex_ai_results["sensitive_info"][category].extend(items)
            # Remove duplicates
            vertex_ai_results["sensitive_info"][category] = list(set(vertex_ai_results["sensitive_info"][category]))
    
    # Ensure other required fields exist in the results
    for field in ["hate_speech", "profanity", "flagged_words", "flagged_sentences"]:
        if field not in vertex_ai_results:
            vertex_ai_results[field] = regex_results[field]
    
    return vertex_ai_results

# =================================================================
# 2. Encryption/Decryption Module with Key Management
# =================================================================

def generate_key():
    """Generate a new encryption key"""
    return Fernet.generate_key()

def save_encryption_key(key, filename="encryption_key.key"):
    """Save encryption key to file"""
    try:
        with open(filename, 'wb') as key_file:
            key_file.write(key)
        print(f"Encryption key saved to {filename}")
        return True
    except Exception as e:
        print(f"Error saving encryption key: {e}")
        return False

def load_encryption_key(filename="encryption_key.key"):
    """Load encryption key from file"""
    try:
        with open(filename, 'rb') as key_file:
            key = key_file.read()
            print(f"Encryption key loaded from {filename}")
            return key
    except FileNotFoundError:
        print("No existing key found. Generating new key.")
        return None
    except Exception as e:
        print(f"Error loading encryption key: {e}")
        return None

# Initialize encryption with persistent key
KEY = load_encryption_key()
if KEY is None:
    KEY = generate_key()
    save_encryption_key(KEY)

cipher_suite = Fernet(KEY)

def encrypt_data(data):
    """Encrypt a string of data"""
    if not isinstance(data, str):
        data = str(data)
    try:
        return cipher_suite.encrypt(data.encode()).decode()
    except Exception as e:
        print(f"Encryption error: {e}")
        return f"[ENCRYPTION_ERROR: {str(e)}]"

def decrypt_data(encrypted_data):
    """Decrypt an encrypted string"""
    try:
        return cipher_suite.decrypt(encrypted_data.encode()).decode()
    except Exception as e:
        print(f"Decryption error: {e}")
        return f"[DECRYPTION_ERROR: {str(e)}]"

# =================================================================
# 3. Text Processing Module
# =================================================================

def process_text(text, detection_results, action="keep"):
    """Process text based on detection results with enhanced tracking"""
    if action == "keep":
        return text, []  # No changes needed
    
    if not detection_results:
        print("Warning: No detection results available. Returning original text.")
        return text, []
        
    processed_text = text
    encryption_log = []
    
    # Process sensitive information first, starting with the longest items
    sensitive_info = detection_results.get("sensitive_info", {})
    
    # Collect all sensitive items with their categories
    all_sensitive_items = []
    for category, items in sensitive_info.items():
        if not items:
            continue
        for item in items:
            if item and isinstance(item, str) and item.strip():
                all_sensitive_items.append((category, item))
    
    # Sort by length (descending) to avoid substring replacement issues
    all_sensitive_items.sort(key=lambda x: len(x[1]), reverse=True)
    
    # Process each sensitive item
    for category, item in all_sensitive_items:
        if action == "remove":
            processed_text = processed_text.replace(item, f"[REDACTED {category.upper()}]")
        elif action == "encrypt":
            encrypted = encrypt_data(item)
            replacement = f"[ENCRYPTED {category.upper()}]"
            processed_text = processed_text.replace(item, replacement)
            encryption_log.append({
                'type': 'sensitive',
                'category': category,
                'original': item,
                'encrypted': encrypted,
                'position': processed_text.find(replacement)
            })
    
    # Handle flagged words
    flagged_words = detection_results.get("flagged_words", [])
    if flagged_words and action != "keep":
        # Sort by length (descending) to avoid substring replacement issues
        flagged_words.sort(key=len, reverse=True)
        
        for word in flagged_words:
            if not word or not isinstance(word, str) or not word.strip():
                continue
                
            if action == "remove":
                processed_text = processed_text.replace(word, "*" * len(word))
            elif action == "encrypt":
                encrypted = encrypt_data(word)
                replacement = f"[ENCRYPTED WORD]"
                processed_text = processed_text.replace(word, replacement)
                encryption_log.append({
                    'type': 'flagged_word',
                    'category': 'profanity',
                    'original': word,
                    'encrypted': encrypted,
                    'position': processed_text.find(replacement)
                })
    
    # Handle flagged sentences
    flagged_sentences = detection_results.get("flagged_sentences", [])
    if flagged_sentences and action != "keep":
        # Sort by length (descending) to avoid substring replacement issues
        flagged_sentences.sort(key=len, reverse=True)
        
        for sentence in flagged_sentences:
            if not sentence or not isinstance(sentence, str) or not sentence.strip():
                continue
                
            if action == "remove":
                processed_text = processed_text.replace(sentence, "[SENTENCE REMOVED DUE TO POLICY VIOLATION]")
            elif action == "encrypt":
                encrypted = encrypt_data(sentence)
                replacement = f"[ENCRYPTED SENTENCE]"
                processed_text = processed_text.replace(sentence, replacement)
                encryption_log.append({
                    'type': 'flagged_sentence',
                    'category': 'hate_speech' if detection_results.get('hate_speech', False) else 'profanity',
                    'original': sentence,
                    'encrypted': encrypted,
                    'position': processed_text.find(replacement)
                })
    
    # If hate speech is detected and removal is requested, consider complete removal
    if detection_results.get("hate_speech", False) and action == "remove":
        if input("\nHate speech detected. Remove entire text? (y/n): ").lower() == 'y':
            processed_text = "[ENTIRE TEXT REMOVED DUE TO HATE SPEECH POLICY VIOLATION]"
            # Clear encryption log since entire text is removed
            encryption_log = []
    
    return processed_text, encryption_log

# =================================================================
# 4. Logging and Tracking Module
# =================================================================

def save_processing_log(original_text, processed_text, detection_results, encryption_log, action):
    """Save processing details to a log file with timestamp"""
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_filename = f"processing_log_{timestamp}.json"
    
    # Create log entry
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "action": action,
        "text_length": len(original_text),
        "detection_summary": {
            "hate_speech": detection_results.get("hate_speech", False),
            "profanity": detection_results.get("profanity", False),
            "flagged_words_count": len(detection_results.get("flagged_words", [])),
            "flagged_sentences_count": len(detection_results.get("flagged_sentences", [])),
            "sensitive_info_detected": any(detection_results.get("sensitive_info", {}).values())
        },
        "changes_made": len(original_text) != len(processed_text),
        "encryption_records": len(encryption_log)
    }
    
    # Save encryption details separately if needed for recovery
    if encryption_log:
        encryption_filename = f"encryption_data_{timestamp}.json"
        try:
            with open(encryption_filename, 'w', encoding='utf-8') as f:
                json.dump(encryption_log, f, indent=2)
            log_entry["encryption_file"] = encryption_filename
        except Exception as e:
            print(f"Error saving encryption data: {e}")
    
    # Save the log
    try:
        with open(log_filename, 'w', encoding='utf-8') as f:
            json.dump(log_entry, f, indent=2)
        print(f"Processing log saved to {log_filename}")
        return log_filename
    except Exception as e:
        print(f"Error saving processing log: {e}")
        return None

# =================================================================
# 5. Recovery Module
# =================================================================

def recover_encrypted_text(processed_text, encryption_log):
    """Recover original text from processed text using encryption log"""
    if not encryption_log:
        print("No encryption log provided. Cannot recover text.")
        return processed_text
        
    recovered_text = processed_text
    
    # Sort the encryption log by position in reverse order
    # This prevents issues with position shifting during replacement
    try:
        sorted_log = sorted(encryption_log, key=lambda x: x.get('position', 0), reverse=True)
        
        for entry in sorted_log:
            encrypted_data = entry.get('encrypted')
            if not encrypted_data:
                continue
                
            replacement = None
            
            if entry['type'] == 'sensitive':
                replacement = f"[ENCRYPTED {entry['category'].upper()}]"
            elif entry['type'] == 'flagged_word':
                replacement = "[ENCRYPTED WORD]"
            elif entry['type'] == 'flagged_sentence':
                replacement = "[ENCRYPTED SENTENCE]"
                
            if replacement and replacement in recovered_text:
                try:
                    original = decrypt_data(encrypted_data)
                    recovered_text = recovered_text.replace(replacement, original, 1)
                except Exception as e:
                    print(f"Error decrypting entry: {e}")
                    continue
    except Exception as e:
        print(f"Error during recovery process: {e}")
    
    return recovered_text

def load_encryption_log(filename):
    """Load encryption log from file"""
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading encryption log: {e}")
        return None

# =================================================================
# 6. Main Function and Command Line Interface
# =================================================================

def main():
    """Main function for text processing with command line interface"""
    print("\n===== Text Content Processing System =====\n")
    
    # Check for Google Cloud project ID
    project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project_id:
        project_id = input("Enter your Google Cloud project ID (or press Enter to set via environment variable): ")
        if project_id:
            os.environ["GOOGLE_CLOUD_PROJECT"] = project_id
            
    # Get Vertex AI location and model name
    location = os.environ.get("VERTEX_AI_LOCATION", "us-central1")
    model_name = os.environ.get("VERTEX_AI_MODEL", "gemini-2.0-flash-001")
    
    # Get input text
    input_method = input("Choose input method (1: Console, 2: File): ")
    text = ""
    
    if input_method == "2":
        filename = input("Enter filename: ")
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                text = f.read()
            print(f"Loaded {len(text)} characters from {filename}")
        except Exception as e:
            print(f"Error loading file: {e}")
            return
    else:
        print("Enter text (type 'END' on a new line when finished):")
        while True:
            line = input()
            if line.strip() == "END":
                break
            text += line + "\n"
    
    if not text.strip():
        print("No text provided. Exiting.")
        return
        
    # Analyze content
    detection_results = detect_content(text, project_id, location, model_name)
    
    if not detection_results:
        print("Content analysis failed. Using basic pattern detection.")
        detection_results = regex_pattern_detection(text)
    
    # Display detection results
    print("\n===== Content Analysis Results =====")
    print(f"Hate Speech Detected: {detection_results.get('hate_speech', False)}")
    print(f"Profanity Detected: {detection_results.get('profanity', False)}")
    
    flagged_words = detection_results.get('flagged_words', [])
    if flagged_words:
        print(f"Flagged Words: {', '.join(flagged_words[:5])}" + 
              (f" and {len(flagged_words) - 5} more" if len(flagged_words) > 5 else ""))
    
    # Display sensitive information statistics
    sensitive_info = detection_results.get('sensitive_info', {})
    if any(sensitive_info.values()):
        print("\nSensitive Information Detected:")
        for category, items in sensitive_info.items():
            if items:
                print(f"- {category.replace('_', ' ').title()}: {len(items)} found")
    
    # Choose action
    print("\n===== Choose Action =====")
    print("1: Keep original text")
    print("2: Remove sensitive/problematic content")
    print("3: Encrypt sensitive/problematic content")
    print("4: Recover previously encrypted text")
    
    action_choice = input("Choose action (1/2/3/4): ")
    
    if action_choice == "4":
        # Recovery mode
        encryption_file = input("Enter encryption data filename: ")
        encryption_log = load_encryption_log(encryption_file)
        
        if not encryption_log:
            print("Could not load encryption data. Exiting.")
            return
            
        recovered_text = recover_encrypted_text(text, encryption_log)
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        recovery_filename = f"recovered_text_{timestamp}.txt"
        
        try:
            with open(recovery_filename, 'w', encoding='utf-8') as f:
                f.write(recovered_text)
            print(f"Recovered text saved to {recovery_filename}")
        except Exception as e:
            print(f"Error saving recovered text: {e}")
            
        return
    
    # Process text based on chosen action
    action = "keep"
    if action_choice == "2":
        action = "remove"
    elif action_choice == "3":
        action = "encrypt"
    
    # Process text
    processed_text, encryption_log = process_text(text, detection_results, action)
    
    # Save results
    print("\n===== Saving Results =====")
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    output_filename = f"processed_text_{timestamp}.txt"
    
    try:
        with open(output_filename, 'w', encoding='utf-8') as f:
            f.write(processed_text)
        print(f"Processed text saved to {output_filename}")
    except Exception as e:
        print(f"Error saving processed text: {e}")
        with open("emergency_output.txt", 'w', encoding='utf-8') as f:
            f.write(processed_text)
        print("Emergency backup saved to emergency_output.txt")
    
    # Log processing details
    log_filename = save_processing_log(text, processed_text, detection_results, encryption_log, action)
    
    # Offer recovery if encrypted
    if action == "encrypt" and encryption_log:
        print("\n===== Recovery Options =====")
        recover_now = input("Recover original text now? (y/n): ")
        
        if recover_now.lower() == 'y':
            recovered_text = recover_encrypted_text(processed_text, encryption_log)
            recovery_filename = f"recovered_text_{timestamp}.txt"
            
            try:
                with open(recovery_filename, 'w', encoding='utf-8') as f:
                    f.write(recovered_text)
                print(f"Recovered text saved to {recovery_filename}")
            except Exception as e:
                print(f"Error saving recovered text: {e}")

if __name__ == "__main__":
    main()